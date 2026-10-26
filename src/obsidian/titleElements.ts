import { App, MarkdownView, TFile } from "obsidian";

/**
 * The editable titles of a note's view: the inline title above the note and the title in the tab
 * header. Both are private API, with a DOM lookup as fallback; only contenteditable ones count.
 */
export function titleElementsFor(view: MarkdownView): HTMLElement[] {
	const inline = view.inlineTitleEl ?? view.containerEl.querySelector<HTMLElement>(".inline-title");
	const header = view.titleEl ?? view.containerEl.querySelector<HTMLElement>(".view-header-title");
	return [inline, header].filter((el): el is HTMLElement => !!el && el.getAttribute("contenteditable") === "true");
}

/** Whether the user is editing `file`'s name in any of its open views. */
export function isTitleFocused(app: App, file: TFile): boolean {
	for (const leaf of app.workspace.getLeavesOfType("markdown")) {
		const view = leaf.view;
		if (!(view instanceof MarkdownView) || view.file !== file) continue;
		for (const el of titleElementsFor(view)) {
			if (el.ownerDocument.activeElement === el) return true;
		}
	}
	return false;
}

/** The title element to put the cursor in: the inline title when it's shown, else the header's. */
export function primaryTitleElement(view: MarkdownView): HTMLElement | null {
	const elements = titleElementsFor(view);
	return elements.find((el) => el.isShown()) ?? elements[0] ?? null;
}
