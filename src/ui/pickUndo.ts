import { KeymapEventHandler, MarkdownView, Notice, Plugin, TAbstractFile, TFile } from "obsidian";

export type PickUndoDeps = {
	/** Renames the note in place, updating links to it; resolves with its new path. */
	rename: (path: string, basename: string) => Promise<string>;
	/** Lowercased names of the other notes in `path`'s folder. */
	takenNames: (path: string) => Set<string>;
	/** The note is back under its old name. */
	onUndone?: (path: string) => void;
};

type Picked = {file: TFile; from: string; to: string; renamed: boolean; handler: KeymapEventHandler};

/**
 * Mod+Z right after picking a suggested title puts the note's old name back: a pick is one step,
 * so one keypress takes it back. Only until the user does something else (edits the note, moves
 * to another, goes back into a title), and only then is Mod+Z bound at all, so it stays the
 * editor's own undo the rest of the time.
 */
export class PickUndo {
	private last: Picked | null = null;

	constructor(private readonly plugin: Plugin, private readonly deps: PickUndoDeps) {
		const {workspace, vault} = plugin.app;
		plugin.registerEvent(workspace.on("editor-change", (_editor, info) => {
			if (info.file === this.last?.file) this.forget();
		}));
		plugin.registerEvent(workspace.on("file-open", (file) => {
			if (file !== this.last?.file) this.forget();
		}));
		plugin.registerEvent(workspace.on("active-leaf-change", (leaf) => {
			const view = leaf?.view;
			if (!(view instanceof MarkdownView) || view.file !== this.last?.file) this.forget();
		}));
		plugin.registerEvent(vault.on("rename", (file) => this.onRename(file)));
		plugin.registerEvent(vault.on("delete", (file) => {
			if (file === this.last?.file) this.forget();
		}));
		plugin.register(() => this.forget());
	}

	/** The user picked `to` for the note named `from`; Obsidian renames it once the title loses focus. */
	picked(file: TFile, from: string, to: string): void {
		this.forget();
		const handler = this.plugin.app.scope.register(["Mod"], "Z", () => this.undo());
		this.last = {file, from, to, renamed: false, handler};
	}

	/** Nothing to take back anymore. Going back into a title makes Mod+Z the title's own undo, for one. */
	forget(): void {
		const picked = this.last;
		if (!picked) return;
		this.last = null;
		this.plugin.app.scope.unregister(picked.handler);
	}

	private onRename(file: TAbstractFile): void {
		const picked = this.last;
		if (!picked || file !== picked.file) return;
		if (!picked.renamed && picked.file.basename === picked.to) picked.renamed = true;
		else this.forget(); // Renamed again, by something else.
	}

	private undo(): false | undefined {
		const picked = this.last;
		// Not renamed (yet, or Obsidian refused the name): Mod+Z is the editor's.
		if (!picked?.renamed) return undefined;
		// In another text box (a modal's, say), Mod+Z is that box's own undo.
		const focused = activeDocument.activeElement;
		if (focused && focused !== activeDocument.body && !this.inViewOf(focused, picked.file)) return undefined;

		this.forget();
		const {file, from} = picked;
		if (this.deps.takenNames(file.path).has(from.toLocaleLowerCase())) {
			new Notice(`Couldn't change the name back: another note here is called “${from}” now.`);
			return false;
		}
		void this.deps.rename(file.path, from).then((path) => this.deps.onUndone?.(path), (error: unknown) => {
			console.error("[Titler] Undoing the rename failed:", error);
			new Notice("Couldn't change the name back.");
		});
		return false;
	}

	private inViewOf(el: Element, file: TFile): boolean {
		return this.plugin.app.workspace.getLeavesOfType("markdown").some((leaf) => (
			leaf.view instanceof MarkdownView && leaf.view.file === file && leaf.view.containerEl.contains(el)
		));
	}
}
