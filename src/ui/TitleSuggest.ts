import { AbstractInputSuggest, App, MarkdownView, setIcon, TFile } from "obsidian";
import { MIN_TITLE_WORDS, TITLE_COUNT } from "../constants";
import { countWords } from "../core/text/words";
import { toPlainText } from "../core/text/plainText";
import { heuristicTitle } from "../core/title/heuristic";
import { resolveAvailableName, sanitizeFileName } from "../core/title/filename";
import { titleKey } from "../core/title/postprocess";
import { EngineStatus, GenerationCancelledError } from "../generation/engine";
import { formatBytes, pendingText } from "../status/modelMessages";
import { MAX_REMEMBERED_TITLES } from "../titling/titleMemory";
import { TitleFormat } from "../types";
import { playReveal } from "./titleEffects";

// Animation lengths in styles.css: a row drawn again mid-animation carries on where it was.
const ENTER_MS = 220;
const ARRIVE_MS = 400;
const SHIMMER_MS = 1400;
/** Rows appearing together enter one after another, this far apart. */
const STAGGER_MS = 35;

type Animated = {
	el?: HTMLElement;
	/** When the row first appears, and when its title arrives, for their animations. */
	shownAt?: number;
	arrivedAt?: number;
};

type Row = Animated & (
	| {kind: "heuristic"; title: string; hint: string}
	| {kind: "model"; title: string | null}
	| {kind: "action"; text: string; action: "download" | "retry" | "more"}
);

export type TitleSuggestDeps = {
	suggestTitles: (request: {markdown: string; currentName: string; format: TitleFormat; signal: AbortSignal; onTitles: (titles: string[]) => void; avoid?: string[]}) => Promise<string[]>;
	/** Titles the AI came up with for the note before, oldest first, while they still fit a note `words` long. */
	recall: (file: TFile, words: number) => string[];
	/** Keeps titles the AI came up with for the note, for the next time. */
	remember: (file: TFile, titles: string[], words: number) => void;
	format: () => TitleFormat;
	engineStatus: () => EngineStatus;
	subscribeEngine: (listener: (status: EngineStatus) => void) => () => void;
	isDownloaded: () => Promise<boolean>;
	downloadBytes: () => number;
	/** Starts the model download, with its notice. */
	download: () => void;
	retry: () => void;
	/** Lowercased names of the other notes in `file`'s folder. */
	takenNames: (file: TFile) => Set<string>;
};

/** What one opening of the popup knows: the note as it was, and the titles coming in for it. */
type Session = {
	file: TFile;
	originalName: string;
	markdown: string;
	/** Words of the note's text: remembered titles are offered while they still fit it. */
	words: number;
	rows: Row[];
	controller: AbortController;
	downloading: boolean;
	/** The row the user moved to; until they do, none is highlighted and Enter keeps the name. */
	selected: Row | null;
	redrawQueued: boolean;
	unsubscribe: () => void;
};

const isTitled = (row: Row): row is Row & {title: string} => row.kind !== "action" && row.title !== null;

/** Plays `cls` on `el` as if it had started at `since` (when that is recent), so drawing a row again doesn't restart it. */
function continueAnimation(el: HTMLElement, cls: string, delayVar: string, since: number | undefined, duration: number): void {
	if (since === undefined) return;
	const elapsed = performance.now() - since;
	if (elapsed >= duration) return;
	el.addClass(cls);
	el.setCssProps({[delayVar]: `${-elapsed}ms`});
}

function placeCaretAtEnd(el: HTMLElement): void {
	const selection = el.win.getSelection();
	if (!selection) return;
	const range = el.doc.createRange();
	range.selectNodeContents(el);
	range.collapse(false);
	selection.removeAllRanges();
	selection.addRange(range);
}

/**
 * Title suggestions under a note's editable title. The first row is instant (the note's first
 * heading or line); below it are the AI's titles, the ones it came up with before or new ones
 * streaming in, and a row to ask it for more. Picking one sets the title and blurs it, so
 * Obsidian's own rename runs (and updates links); Tab puts it in the title to edit first.
 */
export class TitleSuggest extends AbstractInputSuggest<Row> {
	private session: Session | null = null;
	private disposed = false;
	/** Set while the popup moves the highlight itself, so that isn't taken for the user's doing. */
	private highlighting = false;

	constructor(
		app: App,
		private readonly titleEl: HTMLElement,
		private readonly getView: () => MarkdownView | null,
		private readonly deps: TitleSuggestDeps,
	) {
		super(app, titleEl as HTMLDivElement);
		// Few rows either way: "Generate more" stops once the note has its fill of titles.
		this.limit = 0;
		this.onSelect((row, evt) => this.choose(row, evt));
		this.scope.register([], "Tab", () => this.insertHighlighted());
	}

	/** Starts a session when the title gets focus, and opens the popup. */
	begin(): void {
		const view = this.getView();
		const file = view?.file;
		if (this.disposed || !view || !file) return;
		this.end();

		const markdown = view.editor.getValue();
		const session: Session = {
			file,
			originalName: file.basename,
			markdown,
			words: countWords(toPlainText(markdown, {currentName: file.basename})),
			rows: [],
			controller: new AbortController(),
			downloading: false,
			selected: null,
			redrawQueued: false,
			unsubscribe: () => {},
		};
		this.session = session;
		// Frontmatter, code and links don't count: with next to no text there's nothing to suggest a title from.
		if (session.words < MIN_TITLE_WORDS) return;

		const heuristic = heuristicTitle(markdown);
		const heuristicName = heuristic && sanitizeFileName(heuristic.title);
		if (heuristic && heuristicName && titleKey(heuristicName) !== titleKey(session.originalName)) {
			session.rows.push({kind: "heuristic", title: heuristicName, hint: heuristic.source === "heading" ? "From first heading" : "From first line"});
		}
		this.startModelRows(session);
		this.refresh(session);
	}

	/** Ends the session (the title lost focus): stops the AI if it's still working on it. */
	end(): void {
		const session = this.session;
		if (!session) return;
		this.session = null;
		session.unsubscribe();
		session.controller.abort();
		this.close();
	}

	dispose(): void {
		this.disposed = true;
		this.end();
	}

	/**
	 * Obsidian calls this (private API) when the highlight moves: `evt` is null when the list was
	 * drawn, which highlights its first row. The highlight shows what Enter does, so it stays off
	 * until the user moves to a row, and on their row when the list is drawn again.
	 */
	onSelectedChange(row: Row | undefined, evt: MouseEvent | KeyboardEvent | null): void {
		const session = this.session;
		if (!session || this.highlighting) return;
		if (!evt) {
			this.highlight(session, session.selected);
			return;
		}
		// With nothing highlighted, the first step down lands on the first row, not the second.
		const stepDown = evt.instanceOf(KeyboardEvent) && (evt.key === "ArrowDown" || (evt.ctrlKey && evt.key.toLowerCase() === "n"));
		if (session.selected === null && stepDown) {
			this.highlight(session, this.suggestions?.values[0] ?? null);
			return;
		}
		session.selected = row ?? null;
	}

	protected getSuggestions(query: string): Row[] {
		const session = this.session;
		if (this.disposed || !session) return [];
		// Typing their own title: get out of the way (and out of Enter's way).
		if (query.trim() !== session.originalName) return [];
		const rows = session.rows.filter((row) => row.kind !== "model" || row.title !== null || this.pending(session) !== null);
		const now = performance.now();
		let entering = 0;
		for (const row of rows) row.shownAt ??= now + STAGGER_MS * entering++;
		return rows;
	}

	renderSuggestion(row: Row, el: HTMLElement): void {
		el.addClass("titler-suggestion");
		row.el = el;
		continueAnimation(el, "is-entering", "--titler-enter-delay", row.shownAt, ENTER_MS);
		this.paint(row);
	}

	/** The AI's rows: titles it came up with before when there are any, else new ones. */
	private startModelRows(session: Session): void {
		if (this.deps.engineStatus().kind === "disabled") return;
		const shown = new Set([session.originalName, ...session.rows.filter(isTitled).map((row) => row.title)].map(titleKey));
		const remembered = this.deps.recall(session.file, session.words).filter((title) => {
			const key = titleKey(title);
			if (shown.has(key)) return false;
			shown.add(key);
			return true;
		});
		if (remembered.length === 0) {
			void this.ask(session);
			return;
		}
		session.rows.push(...remembered.map((title): Row => ({kind: "model", title})));
		if (this.canAskForMore(session)) session.rows.push(this.moreRow());
	}

	/** Asks the AI for titles (more of them when it gave some already), unless it has to be downloaded or failed to load. */
	private async ask(session: Session): Promise<void> {
		const status = this.deps.engineStatus();
		if (status.kind === "error") {
			this.offer(session, {kind: "action", text: "Couldn't load the AI model. Select to try again.", action: "retry"});
			return;
		}
		if (status.kind === "unloaded" && !(await this.deps.isDownloaded())) {
			if (this.session !== session) return;
			this.offer(session, {kind: "action", text: `Get AI suggestions: download the model (${formatBytes(this.deps.downloadBytes())})`, action: "download"});
			return;
		}
		this.generate(session);
	}

	private generate(session: Session): void {
		const shown = session.rows.filter(isTitled);
		// Asking again: the titles already shown are the ones the reply mustn't repeat.
		const avoid = shown.some((row) => row.kind === "model") ? shown.map((row) => row.title) : undefined;
		const known = new Set(shown.map((row) => titleKey(row.title)));
		const pending: Row[] = Array.from({length: TITLE_COUNT}, () => ({kind: "model", title: null}));
		session.rows = [...shown, ...pending];
		// Keep the keyboard where the new titles come in.
		if (session.selected?.kind === "action") session.selected = pending[0] ?? null;

		// Pending rows show what the model is doing (downloading, loading, thinking) as that changes.
		session.unsubscribe();
		const unsubscribe = this.deps.subscribeEngine(() => {
			if (this.session !== session) return;
			for (const row of pending) if (row.kind === "model" && row.title === null) this.paint(row);
		});
		session.unsubscribe = unsubscribe;
		this.refresh(session);

		this.deps.suggestTitles({
			markdown: session.markdown,
			currentName: session.originalName,
			format: this.deps.format(),
			signal: session.controller.signal,
			avoid,
			onTitles: (titles) => {
				const fresh = titles.filter((title) => !known.has(titleKey(title)));
				pending.forEach((row, index) => {
					if (row.kind !== "model" || row.title !== null || !fresh[index]) return;
					row.title = fresh[index];
					row.arrivedAt = performance.now();
					this.paint(row);
				});
			},
		}).then(() => {
			// Rows the reply didn't fill go away.
			session.rows = session.rows.filter((row) => row.kind !== "model" || row.title !== null);
			const titles = pending.filter(isTitled).map((row) => row.title);
			if (titles.length) this.deps.remember(session.file, titles, session.words);
			if (this.canAskForMore(session)) session.rows.push(this.moreRow());
		}, (error: unknown) => {
			if (error instanceof GenerationCancelledError) return;
			console.error("[Titler] Title suggestions failed:", error);
			session.rows = [
				...session.rows.filter(isTitled),
				{kind: "action", text: "Couldn't get AI suggestions. Select to try again.", action: "retry"},
			];
		}).finally(() => {
			unsubscribe();
			if (this.session !== session) return;
			// A highlighted row the reply didn't fill: the highlight goes to the bottom row, to ask again from.
			if (session.selected && !session.rows.includes(session.selected)) session.selected = session.rows[session.rows.length - 1] ?? null;
			this.refresh(session);
		});
	}

	private moreRow(): Row {
		return {kind: "action", text: "Generate more titles", action: "more"};
	}

	private canAskForMore(session: Session): boolean {
		return session.rows.filter((row) => row.kind === "model").length < MAX_REMEMBERED_TITLES;
	}

	/** Shows `row` as the list's last row, in place of the action row there. */
	private offer(session: Session, row: Row): void {
		const replaced = session.selected?.kind === "action";
		session.rows = [...session.rows.filter((other) => other.kind !== "action"), row];
		if (replaced) session.selected = row;
		this.refresh(session);
	}

	private pending(session: Session): string | null {
		return pendingText(this.deps.engineStatus(), session.downloading);
	}

	/** Draws one row's text, in place, so streaming in doesn't move the keyboard selection. */
	private paint(row: Row): void {
		const el = row.el;
		const session = this.session;
		if (!el || !session) return;
		el.empty();
		if (row.kind === "action") {
			el.addClass("titler-suggestion-action");
			if (row.action === "more") setIcon(el.createSpan({cls: "titler-suggestion-icon"}), "sparkles");
			el.createSpan({cls: "titler-suggestion-title", text: row.text});
			return;
		}
		if (!isTitled(row)) {
			el.addClass("is-pending");
			const text = el.createSpan({cls: "titler-suggestion-pending", text: this.pending(session) ?? ""});
			// In step with the clock, so drawing it again (as progress comes in) doesn't restart the shimmer.
			text.setCssProps({"--titler-shimmer-delay": `${-(performance.now() % SHIMMER_MS)}ms`});
			return;
		}
		el.removeClass("is-pending");
		el.createSpan({cls: "titler-suggestion-title", text: this.available(session, row.title)});
		el.createSpan({cls: "titler-suggestion-hint", text: row.kind === "heuristic" ? row.hint : "AI"});
		continueAnimation(el, "is-arriving", "--titler-arrive-delay", row.arrivedAt, ARRIVE_MS);
	}

	/** The name as it would be saved: with a number when another note in the folder has it already. */
	private available(session: Session, title: string): string {
		return resolveAvailableName(title, this.deps.takenNames(session.file));
	}

	/** Draws the list again (keeping the highlight): for rows appearing or going away. Calls in one go draw it once. */
	private refresh(session: Session): void {
		if (session.redrawQueued) return;
		session.redrawQueued = true;
		queueMicrotask(() => {
			session.redrawQueued = false;
			if (this.session !== session || this.titleEl.ownerDocument.activeElement !== this.titleEl) return;
			this.titleEl.dispatchEvent(new Event("input", {bubbles: true}));
		});
	}

	/** Highlights `row`, or no row: Obsidian always has one selected, so then it's the first, unmarked. */
	private highlight(session: Session, row: Row | null): void {
		const list = this.suggestions;
		if (!list) return;
		const index = row ? list.values.indexOf(row) : -1;
		this.highlighting = true;
		try {
			list.setSelectedItem(Math.max(index, 0), null);
		} finally {
			this.highlighting = false;
		}
		session.selected = index >= 0 ? row : null;
		if (index < 0) list.getSelectedElement?.()?.removeClass("is-selected");
	}

	/** Tab: the highlighted title goes into the field, to edit before it's saved. */
	private insertHighlighted(): false | undefined {
		const session = this.session;
		const row = session?.selected;
		// Nothing highlighted: Tab leaves the title, as without the popup.
		if (!session || !row) return undefined;
		if (!isTitled(row)) return false;
		this.setValue(this.available(session, row.title));
		placeCaretAtEnd(this.titleEl);
		// As if typed: Obsidian checks the name, and the popup, no longer showing the old one, closes.
		this.titleEl.dispatchEvent(new Event("input", {bubbles: true}));
		return false;
	}

	private choose(row: Row, evt: MouseEvent | KeyboardEvent): void {
		const session = this.session;
		if (!session) return;

		// Enter with no row highlighted is the user confirming the title as typed, as without the popup.
		if (evt.instanceOf(KeyboardEvent) && session.selected === null) {
			this.close();
			this.titleEl.blur();
			return;
		}

		if (row.kind === "action") {
			if (row.action === "download") {
				session.downloading = true;
				this.deps.download();
				this.generate(session);
			} else if (row.action === "retry") {
				this.deps.retry();
				this.generate(session);
			} else {
				void this.ask(session);
			}
			return;
		}
		if (row.title === null) return; // Still on its way.

		this.setValue(this.available(session, row.title));
		playReveal(this.titleEl);
		this.close();
		// Blur hands the rename to Obsidian's own title handling, which validates it and updates links.
		this.titleEl.blur();
	}
}
