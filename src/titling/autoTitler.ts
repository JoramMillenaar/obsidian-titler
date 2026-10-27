import { NotesPort } from "../ports";
import { TitleFormat } from "../types";
import { MIN_TITLE_WORDS } from "../constants";
import { KeyedDebouncer } from "../core/util/debounce";
import { decideAutoTitle } from "../core/rules/autoTitleEligibility";
import { chooseName } from "../core/title/filename";
import { GenerationCancelledError } from "../generation/engine";

export type AutoTitlerDeps = {
	notes: NotesPort;
	/** Titles for a note, best first, from the background lane. */
	suggest: (request: {markdown: string; currentName: string; format: TitleFormat; signal: AbortSignal}) => Promise<string[]>;
	settings: () => {autoTitle: boolean; minWords: number; format: TitleFormat};
	/** Whether the model can run without a download, and isn't turned off on this device. */
	isModelAvailable: () => Promise<boolean>;
	isUntitled: (basename: string) => boolean;
	isExcludedPath: (path: string) => boolean;
	isTitleFocused: (path: string) => boolean;
	/** Words of the note's text, as titles see it. */
	countWords: (markdown: string) => number;
	/** Tells the user a note was named, offering `undo`. */
	notifyRenamed: (from: string, to: string, undo: () => Promise<void>) => void;
	/** The AI started (true) or stopped (false) thinking of a name for the note at `path`. */
	onNaming?: (path: string, naming: boolean) => void;
	/** Every title the AI came up with for the note, the one it's named after included, and how long the note was. */
	remember?: (path: string, titles: string[], words: number, format: TitleFormat) => void;
	/** How long typing has to pause before the note is named. */
	pauseMs: number;
};

type NoteState = {
	/** Words the note had when first seen this session: text that was there already wasn't typed now. */
	baseline: number | null;
	/** Waiting for the user to finish editing the title. */
	postponed: boolean;
	running: AbortController | null;
};

/** What naming a note on request came to. */
export type NameNowResult =
	| {ok: true; path: string}
	| {ok: false; skip: "missing" | "too-short" | "no-name"};

const basenameOf = (path: string) => (path.split("/").pop() ?? path).replace(/\.md$/i, "");
const extensionOf = (path: string) => /\.([^./]+)$/.exec(path)?.[1]?.toLowerCase() ?? "";

/**
 * Names "Untitled" notes once there's something to name them by: when typing pauses, or when the
 * user leaves the note, whichever comes first. Only local edits trigger it, so a note that arrives
 * by sync is left to the device it was written on. Every rename can be undone, and an undone note
 * is left alone for the rest of the session.
 */
export class AutoTitler {
	private readonly states = new Map<string, NoteState>();
	private readonly optedOut = new Set<string>();
	private readonly debouncer: KeyedDebouncer<string>;
	private disposed = false;

	constructor(private readonly deps: AutoTitlerDeps) {
		this.debouncer = new KeyedDebouncer(deps.pauseMs);
	}

	/** The note was opened: remember how much text it already had. */
	async seen(path: string): Promise<void> {
		if (this.states.get(path)?.baseline != null) return;
		const markdown = await this.deps.notes.read(path);
		const state = this.state(path);
		state.baseline ??= markdown === null ? 0 : this.deps.countWords(markdown);
	}

	/** The user typed in the note. */
	edited(path: string): void {
		if (this.disposed || extensionOf(path) !== "md" || !this.deps.isUntitled(basenameOf(path))) return;
		if (this.state(path).baseline === null) void this.seen(path);
		this.debouncer.schedule(path, () => this.run(path));
	}

	/** The user moved away from the note: don't wait for the pause. */
	left(path: string): void {
		this.debouncer.flush(path);
	}

	/** The user stopped editing the note's title: a naming postponed for it can go ahead. */
	titleBlurred(path: string): void {
		const state = this.states.get(path);
		if (!state?.postponed) return;
		state.postponed = false;
		this.debouncer.schedule(path, () => this.run(path));
	}

	renamed(oldPath: string, newPath: string): void {
		const state = this.states.get(oldPath);
		if (state) {
			// Renamed by someone else while a name was being thought up: theirs wins.
			state.running?.abort();
			this.states.delete(oldPath);
			this.states.set(newPath, {...state, running: null});
		}
		if (this.optedOut.delete(oldPath)) this.optedOut.add(newPath);
		this.debouncer.cancel(oldPath);
	}

	deleted(path: string): void {
		this.states.get(path)?.running?.abort();
		this.states.delete(path);
		this.optedOut.delete(path);
		this.debouncer.cancel(path);
	}

	/** Names the note now, whatever its name (the user asked), as long as it has some text to name it by. */
	async nameNow(path: string): Promise<NameNowResult> {
		const markdown = await this.deps.notes.read(path);
		if (markdown === null) return {ok: false, skip: "missing"};
		if (this.deps.countWords(markdown) < MIN_TITLE_WORDS) return {ok: false, skip: "too-short"};
		const renamed = await this.name(path, markdown, () => this.deps.notes.exists(path));
		return renamed ? {ok: true, path: renamed} : {ok: false, skip: "no-name"};
	}

	dispose(): void {
		this.disposed = true;
		this.debouncer.cancel();
		for (const state of this.states.values()) state.running?.abort();
		this.states.clear();
	}

	private state(path: string): NoteState {
		let state = this.states.get(path);
		if (!state) {
			state = {baseline: null, postponed: false, running: null};
			this.states.set(path, state);
		}
		return state;
	}

	/** Whether `path` should be named right now, given its current text. */
	private async eligible(path: string, markdown: string): Promise<{ok: boolean; postpone: boolean}> {
		const settings = this.deps.settings();
		const state = this.state(path);
		const decision = decideAutoTitle({
			enabled: settings.autoTitle && await this.deps.isModelAvailable(),
			extension: extensionOf(path),
			isUntitled: this.deps.isUntitled(basenameOf(path)),
			inExcludedFolder: this.deps.isExcludedPath(path),
			frontmatterKeys: this.deps.notes.frontmatterKeys(path),
			wordsTyped: this.deps.countWords(markdown) - (state.baseline ?? 0),
			minWords: settings.minWords,
			optedOut: this.optedOut.has(path),
			titleFocused: this.deps.isTitleFocused(path),
		});
		return {ok: decision.ok, postpone: !decision.ok && decision.skip === "editing-title"};
	}

	private async run(path: string): Promise<void> {
		if (this.disposed || !this.deps.notes.exists(path)) return;
		const state = this.state(path);
		if (state.running) return;

		const markdown = await this.deps.notes.read(path);
		if (markdown === null) return;
		const {ok, postpone} = await this.eligible(path, markdown);
		state.postponed = postpone;
		if (!ok) return;

		await this.name(path, markdown, async () => {
			// Things change while the model thinks: re-check against the note as it is now.
			const current = await this.deps.notes.read(path);
			if (current === null) return false;
			const check = await this.eligible(path, current);
			state.postponed = check.postpone;
			return check.ok;
		});
	}

	private async name(path: string, markdown: string, stillWanted: () => boolean | Promise<boolean>): Promise<string | null> {
		const state = this.state(path);
		const controller = new AbortController();
		state.running = controller;
		try {
			const format = this.deps.settings().format;
			let titles: string[];
			this.deps.onNaming?.(path, true);
			try {
				titles = await this.deps.suggest({markdown, currentName: basenameOf(path), format, signal: controller.signal});
			} finally {
				// Before the rename below, so it's told under the path it was started with.
				this.deps.onNaming?.(path, false);
			}
			if (controller.signal.aborted || !this.deps.notes.exists(path)) return null;
			// Kept even when the note isn't named now: they're what the popup offers for it.
			if (titles.length) this.deps.remember?.(path, titles, this.deps.countWords(markdown), format);
			if (!(await stillWanted())) return null;

			const name = chooseName(titles, this.deps.notes.takenNames(path), (candidate) => this.deps.notes.isLinkTaken(candidate, path));
			if (!name) return null;
			const from = path;
			const to = await this.deps.notes.rename(path, name);
			this.deps.notifyRenamed(from, to, () => this.undo(from, to));
			return to;
		} catch (error) {
			if (!(error instanceof GenerationCancelledError)) console.error(`[Titler] Could not name ${path}:`, error);
			return null;
		} finally {
			if (state.running === controller) state.running = null;
		}
	}

	private async undo(from: string, to: string): Promise<void> {
		if (!this.deps.notes.exists(to)) return;
		const original = basenameOf(from);
		if (this.deps.notes.takenNames(to).has(original.toLocaleLowerCase())) return;
		const restored = await this.deps.notes.rename(to, original);
		this.optedOut.add(restored);
	}
}
