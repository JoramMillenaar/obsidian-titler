import { Notice } from "obsidian";
import { GenerationEngine } from "../generation/engine";
import { formatBytes } from "../status/modelMessages";

const DONE_MS = 6000;

/**
 * The one-time notice while the AI model downloads: what's happening and how far along, with a
 * way to put it off. The download continues if the notice is dismissed; the status bar keeps count.
 */
export function showDownloadNotice(engine: GenerationEngine): void {
	const size = formatBytes(engine.config().downloadBytes[engine.config().dtype.webgpu] ?? 0);
	const fragment = createFragment();
	const message = fragment.createDiv({text: `Titler is downloading its AI model (${size}). This happens once; after that it works offline.`});
	const button = fragment.createEl("button", {text: "Not now", cls: "titler-notice-button"});
	const notice = new Notice(fragment, 0);

	let unsubscribe = () => {};
	const finish = (text: string | null) => {
		unsubscribe();
		button.remove();
		if (text === null) {
			notice.hide();
			return;
		}
		message.setText(text);
		window.setTimeout(() => notice.hide(), DONE_MS);
	};

	button.addEventListener("click", (evt) => {
		evt.stopPropagation();
		engine.unload();
		finish("Download stopped. Titler's settings can start it again whenever you like.");
	});

	unsubscribe = engine.subscribe((status) => {
		if (status.kind === "loading" && status.progress !== null) {
			message.setText(`Titler is downloading its AI model (${size}): ${Math.floor(status.progress)}%. This happens once; after that it works offline.`);
		} else if (status.kind === "ready") {
			finish("Titler is ready. Select a note's title to see suggestions.");
		} else if (status.kind === "error") {
			finish(`Titler couldn't download its AI model: ${status.message}`);
		} else if (status.kind === "disabled") {
			finish(null);
		}
	});
}
