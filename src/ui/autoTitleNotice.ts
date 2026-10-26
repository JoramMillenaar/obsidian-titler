import { Notice } from "obsidian";

const NOTICE_MS = 10_000;

/** "Named “X”." with an Undo button, after a note was named automatically. */
export function showRenamedNotice(name: string, undo: () => Promise<void>): void {
	const fragment = createFragment();
	fragment.createSpan({text: `Named “${name}”.`});
	const button = fragment.createEl("button", {text: "Undo", cls: "titler-notice-undo"});
	const notice = new Notice(fragment, NOTICE_MS);
	button.addEventListener("click", (evt) => {
		evt.stopPropagation();
		notice.hide();
		void undo().catch((error: unknown) => {
			console.error("[Titler] Undo failed:", error);
			new Notice("Couldn't undo the rename.");
		});
	});
}
