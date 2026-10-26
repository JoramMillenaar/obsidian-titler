/** The vault, as auto-title needs it. Paths are vault paths ("Folder/Note.md"). */
export interface NotesPort {
	/** The note's current markdown: the editor's content when it's open (fresher than the saved file). */
	read(path: string): Promise<string | null>;

	exists(path: string): boolean;

	/** Lowercased names of the other notes in `path`'s folder. */
	takenNames(path: string): Set<string>;

	/** Whether a link to `name` would already lead to a note other than `path`. */
	isLinkTaken(name: string, path: string): boolean;

	frontmatterKeys(path: string): string[];

	/** Renames the note in place, updating links to it; resolves with its new path. */
	rename(path: string, basename: string): Promise<string>;
}
