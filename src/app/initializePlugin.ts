import { AppContainer } from "../appContainer";
import { statusBarMessage } from "../status/modelMessages";

/**
 * Starts what runs in the background once the workspace is ready: the status bar follows the
 * model, and on the first run the model downloads. After that, it only loads when needed.
 */
export function initializePlugin(app: AppContainer, isFirstRun: boolean): () => void {
	let downloading = false;
	const unsubscribe = app.engine.subscribe((status) => {
		if (status.kind === "loading" && !downloading) {
			// Whether this load downloads: the cache only holds a file once it's fully downloaded.
			void app.engine.isDownloaded().then((downloaded) => {
				downloading = !downloaded && app.engine.status().kind === "loading";
			});
		}
		if (status.kind !== "loading") {
			if (downloading && status.kind === "ready") app.status.update("AI model downloaded.", 4000);
			downloading = false;
		}
		const message = statusBarMessage(status);
		if (message) app.status.update(message.text, message.timeout);
	});

	if (app.deviceSettingsRepo.get().modelDisabled) {
		app.engine.disable();
	} else if (isFirstRun) {
		app.downloadModel();
	}
	return unsubscribe;
}
