import "obsidian";

/** Private Obsidian APIs the plugin reads, each with a fallback where it's used. */
declare module "obsidian" {
	interface App {
		setting: {open(): void; openTabById(id: string): void};
		internalPlugins?: {
			getPluginById?(id: string): {enabled?: boolean; instance?: {options?: Record<string, unknown>}} | null;
		};
		plugins?: {plugins?: Record<string, {settings?: Record<string, unknown>} | undefined>};
	}

	interface AbstractInputSuggest<T> {
		/**
		 * The popup's rows. Obsidian also calls its owner's `onSelectedChange(value, evt)` when the
		 * highlight moves, with a null `evt` when the list was drawn.
		 */
		suggestions?: {
			values: T[];
			setSelectedItem(index: number, evt: MouseEvent | KeyboardEvent | null): void;
			getSelectedElement?(): HTMLElement | null;
		};
	}

	interface MarkdownView {
		/** The editable title above the note ("Show inline title" in Appearance settings). */
		inlineTitleEl?: HTMLElement;
		/** The editable title in the tab's header. */
		titleEl?: HTMLElement;
	}
}

declare global {
	interface Window {
		/** Obsidian's translation function, for its own localized strings. */
		i18next?: {t(key: string): string};
	}
}
