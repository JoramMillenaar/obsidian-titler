import { App, MarkdownView, normalizePath, TFile } from "obsidian";
import { NotesPort } from "../ports";

export class ObsidianNotes implements NotesPort {
	constructor(private readonly app: App) {
	}

	private file(path: string): TFile | null {
		const file = this.app.vault.getAbstractFileByPath(path);
		return file instanceof TFile ? file : null;
	}

	async read(path: string): Promise<string | null> {
		const file = this.file(path);
		if (!file) return null;
		// An open note's editor runs ahead of the file on disk (saves are debounced).
		for (const leaf of this.app.workspace.getLeavesOfType("markdown")) {
			const view = leaf.view;
			if (view instanceof MarkdownView && view.file === file) return view.editor.getValue();
		}
		return this.app.vault.cachedRead(file);
	}

	exists(path: string): boolean {
		return this.file(path) !== null;
	}

	takenNames(path: string): Set<string> {
		const file = this.file(path);
		const folder = file?.parent ?? this.app.vault.getRoot();
		return new Set(
			folder.children
				.filter((child): child is TFile => child instanceof TFile && child.extension === "md" && child !== file)
				.map((child) => child.basename.toLocaleLowerCase()),
		);
	}

	isLinkTaken(name: string, path: string): boolean {
		const destination = this.app.metadataCache.getFirstLinkpathDest(name, path);
		return destination !== null && destination.path !== path;
	}

	frontmatterKeys(path: string): string[] {
		const file = this.file(path);
		const frontmatter = file ? this.app.metadataCache.getFileCache(file)?.frontmatter : undefined;
		return frontmatter ? Object.keys(frontmatter) : [];
	}

	async rename(path: string, basename: string): Promise<string> {
		const file = this.file(path);
		if (!file) throw new Error(`No note at ${path}`);
		const folder = file.parent && !file.parent.isRoot() ? `${file.parent.path}/` : "";
		const newPath = normalizePath(`${folder}${basename}.${file.extension}`);
		// fileManager (not vault) renames, so links to the note follow it.
		await this.app.fileManager.renameFile(file, newPath);
		return newPath;
	}
}
