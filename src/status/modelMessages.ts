import { EngineStatus } from "../generation/engine";

/** What the user reads about the AI model, wherever it shows: the popup, the status bar, settings. */

export function formatBytes(bytes: number): string {
	return bytes >= 1_000_000_000 ? `${(bytes / 1_000_000_000).toFixed(1)} GB` : `${Math.round(bytes / 1_000_000)} MB`;
}

/** Text for a title that is still on its way, or null when there's nothing to wait for. */
export function pendingText(status: EngineStatus, downloading: boolean): string | null {
	if (status.kind === "loading") {
		return downloading && status.progress !== null
			? `Downloading the AI model… ${Math.floor(status.progress)}%`
			: "Loading the AI model…";
	}
	if (status.kind === "ready" || status.kind === "unloaded") return "Thinking…";
	return null;
}

/** The status bar line for `status`, with how long it stays (null: until the next status). */
export function statusBarMessage(status: EngineStatus, downloading: boolean): {text: string; timeout: number | null} | null {
	if (status.kind === "loading" && downloading) {
		return {text: status.progress === null ? "Downloading AI model…" : `Downloading AI model… ${Math.floor(status.progress)}%`, timeout: null};
	}
	if (status.kind === "error") {
		return {text: status.offline ? "AI model unavailable while offline." : "AI model failed to load (see settings).", timeout: 8000};
	}
	return null;
}

/** The model's state as settings describe it. */
export function settingsStatusText(status: EngineStatus, downloaded: boolean, downloadBytes: number): string {
	const size = formatBytes(downloadBytes);
	if (status.kind === "disabled") return "Turned off on this device.";
	if (status.kind === "error") {
		return status.offline
			? `Couldn't load: you appear to be offline. ${downloaded ? "" : `The model (${size}) still needs to be downloaded once.`}`.trim()
			: `Couldn't load: ${status.message}`;
	}
	if (status.kind === "loading") {
		return !downloaded && status.progress !== null
			? `Downloading… ${Math.floor(status.progress)}% of ${size}.`
			: "Loading…";
	}
	if (status.kind === "ready") {
		return `Ready, running on your ${status.device === "webgpu" ? "GPU" : "CPU (slower)"}.`;
	}
	return downloaded ? `Downloaded (${size}). Loads when needed.` : `Not downloaded yet (${size}).`;
}
