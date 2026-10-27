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

/**
 * The status bar line for `status`, with how long it stays (null: until the next status). Loading
 * has none: the status bar icon's ring shows how far along it is.
 */
export function statusBarMessage(status: EngineStatus): {text: string; timeout: number | null} | null {
	if (status.kind === "error") {
		return {text: status.offline ? "AI model unavailable while offline." : "AI model failed to load (see settings).", timeout: 8000};
	}
	return null;
}

/** "45 seconds", "10 minutes", "1.5 hours", "1 day". */
export function formatDuration(seconds: number): string {
	const units: [number, string][] = [[86_400, "day"], [3600, "hour"], [60, "minute"], [1, "second"]];
	const [size, name] = units.find(([unit]) => seconds >= unit) ?? [1, "second"];
	const amount = Math.round((seconds / size) * 10) / 10;
	return `${amount} ${name}${amount === 1 ? "" : "s"}`;
}

/** "9:05" for minutes and seconds, "1:02:05" past an hour. */
export function formatCountdown(ms: number): string {
	const total = Math.max(0, Math.ceil(ms / 1000));
	const pad = (value: number) => String(value).padStart(2, "0");
	const hours = Math.floor(total / 3600);
	const minutes = Math.floor((total % 3600) / 60);
	const seconds = total % 60;
	return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${minutes}:${pad(seconds)}`;
}

export type ModelDetails = {
	label: string;
	license: string;
	languages: string;
	downloadBytes: number;
	/** The idle time setting. */
	unloadAfterSeconds: number;
	/** How long until the model unloads by itself; null while it's in use. */
	unloadsInMs: number | null;
};

function unloadLine(model: ModelDetails): string {
	if (model.unloadsInMs !== null) return `Unloads by itself in ${formatCountdown(model.unloadsInMs)}`;
	return model.unloadAfterSeconds === 0
		? "In use; unloads as soon as it's done"
		: `In use; unloads ${formatDuration(model.unloadAfterSeconds)} after`;
}

/**
 * What the status bar icon's menu says about the model in memory, and what its button does; null
 * when the model isn't in memory (and the icon is hidden).
 */
export function modelMenu(status: EngineStatus, model: ModelDetails): {lines: string[]; action: string} | null {
	if (status.kind === "loading") {
		return {lines: [model.label, status.progress === null ? "Loading…" : `Loading… ${Math.floor(status.progress)}%`], action: "Stop loading"};
	}
	if (status.kind !== "ready") return null;
	return {
		lines: [
			`${model.label} · ${formatBytes(model.downloadBytes)}`,
			`On your ${status.device === "webgpu" ? "GPU" : "CPU"} (${status.dtype}), loaded in ${(status.loadMs / 1000).toFixed(1)} s`,
			unloadLine(model),
			`${model.languages} · ${model.license}`,
		],
		action: "Unload model",
	};
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
