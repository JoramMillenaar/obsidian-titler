import { AbstractInputSuggest, App, MarkdownView, TFile } from "obsidian";
import { TITLE_COUNT } from "../constants";
import { countWords } from "../core/text/words";
import { heuristicTitle } from "../core/title/heuristic";
import { resolveAvailableName, sanitizeFileName } from "../core/title/filename";
import { titleKey } from "../core/title/postprocess";
import { EngineStatus, GenerationCancelledError } from "../generation/engine";
import { formatBytes, pendingText } from "../status/modelMessages";
import { TitleFormat } from "../types";

/** Notes shorter than this get no popup: there's nothing to suggest a title from yet. */
const POPUP_MIN_WORDS = 5;

type Row =
	| {kind: "heuristic"; title: string; hint: string; el?: HTMLElement}
	| {kind: "model"; title: string | null; el?: HTMLElement}
	| {kind: "action"; text: string; action: "download" | "retry"; el?: HTMLElement};

export type TitleSuggestDeps = {
	suggestTitles: (request: {markdown: string; currentName: string; format: TitleFormat; signal: AbortSignal; onTitles: (titles: string[]) => void}) => Promise<string[]>;
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
	rows: Row[];
	controller: AbortController;
	downloading: boolean;
	/** Whether the user moved through the list with the arrow keys; plain Enter keeps the name. */
	navigated: boolean;
	unsubscribe: () => void;
};

/**
 * Title suggestions under a note's editable title. The first row is instant (the note's first
 * heading or line), the AI's titles fill in the rows below as they stream in. Picking one sets the
 * title and blurs it, so Obsidian's own rename runs (and updates links).
 */
export class TitleSuggest extends AbstractInputSuggest<Row> {
	private session: Session | null = null;
	private disposed = false;

	constructor(
		app: App,
		private readonly titleEl: HTMLElement,
		private readonly getView: () => MarkdownView | null,
		private readonly deps: TitleSuggestDeps,
	) {
		super(app, titleEl as HTMLDivElement);
		this.limit = TITLE_COUNT + 2;
		this.onSelect((row, evt) => this.choose(row, evt));
	}

	/** Starts a session when the title gets focus, and opens the popup. */
	begin(): void {
		const view = this.getView();
		const file = view?.file;
		if (this.disposed || !view || !file) return;
		this.end();

		const markdown = view.editor.getValue();
		const controller = new AbortController();
		const session: Session = {
			file,
			originalName: file.basename,
			markdown,
			rows: [],
			controller,
			downloading: false,
			navigated: false,
			unsubscribe: () => {},
		};
		this.session = session;
		if (countWords(markdown) < POPUP_MIN_WORDS) return;

		const heuristic = heuristicTitle(markdown);
		const heuristicName = heuristic && sanitizeFileName(heuristic.title);
		if (heuristic && heuristicName && titleKey(heuristicName) !== titleKey(session.originalName)) {
			session.rows.push({kind: "heuristic", title: heuristicName, hint: heuristic.source === "heading" ? "From first heading" : "From first line"});
		}
		void this.startModelRows(session);
		this.titleEl.dispatchEvent(new Event("input", {bubbles: true}));
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

	/** Marks keyboard navigation, so Enter picks the highlighted row instead of keeping the name. */
	noteKey(evt: KeyboardEvent): void {
		if (this.session && (evt.key === "ArrowDown" || evt.key === "ArrowUp")) this.session.navigated = true;
	}

	dispose(): void {
		this.disposed = true;
		this.end();
	}

	protected getSuggestions(query: string): Row[] {
		const session = this.session;
		if (this.disposed || !session) return [];
		// Typing their own title: get out of the way (and out of Enter's way).
		if (query.trim() !== session.originalName) return [];
		return session.rows.filter((row) => row.kind !== "model" || row.title !== null || this.pending(session) !== null);
	}

	renderSuggestion(row: Row, el: HTMLElement): void {
		el.addClass("titler-suggestion");
		row.el = el;
		this.paint(row);
	}

	private async startModelRows(session: Session): Promise<void> {
		const status = this.deps.engineStatus();
		if (status.kind === "disabled") return;
		if (status.kind === "error") {
			session.rows.push({kind: "action", text: "Couldn't load the AI model. Select to try again.", action: "retry"});
			this.refresh(session);
			return;
		}
		if (status.kind === "unloaded" && !(await this.deps.isDownloaded())) {
			if (this.session !== session) return;
			session.rows.push({kind: "action", text: `Get AI suggestions: download the model (${formatBytes(this.deps.downloadBytes())})`, action: "download"});
			this.refresh(session);
			return;
		}
		this.generate(session);
	}

	private generate(session: Session): void {
		const modelRows: Row[] = Array.from({length: TITLE_COUNT}, () => ({kind: "model", title: null}));
		session.rows = [...session.rows.filter((row) => row.kind === "heuristic"), ...modelRows];
		const heuristicKeys = new Set(session.rows.filter((row) => row.kind === "heuristic").map((row) => titleKey((row as {title: string}).title)));

		// Pending rows show what the model is doing (downloading, loading, thinking) as that changes.
		session.unsubscribe();
		const unsubscribe = this.deps.subscribeEngine(() => {
			if (this.session !== session) return;
			for (const row of modelRows) if (row.kind === "model" && row.title === null) this.paint(row);
		});
		session.unsubscribe = unsubscribe;
		this.refresh(session);

		this.deps.suggestTitles({
			markdown: session.markdown,
			currentName: session.originalName,
			format: this.deps.format(),
			signal: session.controller.signal,
			onTitles: (titles) => {
				const fresh = titles.filter((title) => !heuristicKeys.has(titleKey(title)));
				modelRows.forEach((row, index) => {
					if (row.kind !== "model" || row.title !== null || !fresh[index]) return;
					row.title = fresh[index];
					this.paint(row);
				});
			},
		}).then(() => {
			// Rows the reply didn't fill go away.
			session.rows = session.rows.filter((row) => row.kind !== "model" || row.title !== null);
		}, (error: unknown) => {
			if (error instanceof GenerationCancelledError) return;
			console.error("[Titler] Title suggestions failed:", error);
			session.rows = [
				...session.rows.filter((row) => row.kind === "heuristic" || (row.kind === "model" && row.title !== null)),
				{kind: "action", text: "Couldn't get AI suggestions. Select to try again.", action: "retry"},
			];
		}).finally(() => {
			unsubscribe();
			if (this.session === session) this.refresh(session);
		});
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
			el.createSpan({text: row.text});
			return;
		}
		if (row.kind === "model" && row.title === null) {
			el.addClass("is-pending");
			el.createSpan({cls: "titler-suggestion-pending", text: this.pending(session) ?? ""});
			return;
		}
		el.removeClass("is-pending");
		el.createSpan({text: this.available(session, row.title!)});
		el.createSpan({cls: "titler-suggestion-hint", text: row.kind === "heuristic" ? row.hint : "AI"});
	}

	/** The name as it would be saved: with a number when another note in the folder has it already. */
	private available(session: Session, title: string): string {
		return resolveAvailableName(title, this.deps.takenNames(session.file));
	}

	/** Re-renders the list (which also resets the selection): for rows appearing or going away. */
	private refresh(session: Session): void {
		if (this.session !== session || this.titleEl.ownerDocument.activeElement !== this.titleEl) return;
		this.titleEl.dispatchEvent(new Event("input", {bubbles: true}));
	}

	private choose(row: Row, evt: MouseEvent | KeyboardEvent): void {
		const session = this.session;
		if (!session) return;

		// Enter without moving through the list is the user confirming the title as typed, as without the popup.
		if (evt instanceof KeyboardEvent && !session.navigated) {
			this.close();
			this.titleEl.blur();
			return;
		}

		if (row.kind === "action") {
			if (row.action === "download") {
				session.downloading = true;
				this.deps.download();
			} else {
				this.deps.retry();
			}
			this.generate(session);
			return;
		}
		if (row.title === null) return; // Still on its way.

		this.setValue(this.available(session, row.title));
		this.close();
		// Blur hands the rename to Obsidian's own title handling, which validates it and updates links.
		this.titleEl.blur();
	}
}
