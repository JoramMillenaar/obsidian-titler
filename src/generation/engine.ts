import { Device, DType, GenerationModelConfig } from "../types";
import { MIN_DOWNLOAD_PROGRESS_BYTES } from "../constants";
import { Unsubscribe } from "../core/util/unsubscribe";
import { DownloadProgress } from "../core/progress";
import { parseList } from "../core/title/parse";
import { looksUnusable } from "../core/title/sanity";
import { GenerationRequest, GenerationResult, Lane, WorkerRequest, WorkerResponse } from "./protocol";

/** What the model is doing, as settings, the status bar and the title popup show it. */
export type EngineStatus =
	| {kind: "disabled"}
	| {kind: "unloaded"}
	| {kind: "loading"; progress: number | null}
	| {kind: "ready"; device: Device; dtype: DType; loadMs: number}
	| {kind: "error"; message: string; offline: boolean};

/** Keeps the model loaded until released. Releasing twice is harmless. */
export type ModelLease = {release(): void};

export type GenerateOptions = {
	lane: Lane;
	/** Aborting stops the generation in the worker too, at its next token. */
	signal?: AbortSignal;
	/** Each piece of the reply as it streams in. */
	onDelta?: (text: string) => void;
};

export type GenerationEngineDeps = {
	getConfig: () => GenerationModelConfig;
	/** Starts a Worker running the model worker bundle. */
	startWorker: () => Worker;
	allowWebGpu: boolean;
	/** Read at every load: WebGPU gave broken output on this device before. */
	isForceWasm: () => boolean;
	/** Whether the model's weights are on this device already, so loading it won't download anything. */
	isDownloaded: (config: GenerationModelConfig) => Promise<boolean>;
	cacheKey: string;
	/** How long the model stays loaded after its last lease is released, read each time that countdown starts. */
	idleMs: () => number;
	/** Called when WebGPU output looked broken twice in a row: the caller decides whether to switch to WASM. */
	onUnusableGpuOutput?: () => void;
	/** The clock {@link GenerationEngine.unloadsAt} reads, in milliseconds; `Date.now` unless a test passes its own. */
	now?: () => number;
};

type Loading = {
	kind: "loading";
	worker: Worker;
	progress: number | null;
	tracker: DownloadProgress;
	stallTimer: number | null;
	/** Resolves once loading settles, either way. */
	settled: Promise<void>;
	settle: () => void;
};

type Ready = {kind: "ready"; worker: Worker; device: Device; dtype: DType; loadMs: number};

type State =
	| {kind: "disabled"}
	| {kind: "unloaded"}
	| Loading
	| Ready
	| {kind: "error"; message: string; offline: boolean};

type PendingGeneration = {
	resolve: (result: GenerationResult) => void;
	reject: (error: Error) => void;
	onDelta?: (text: string) => void;
	armStall: () => void;
	cleanup: () => void;
};

/** No progress for this long while loading counts as a failed load. Big models download for minutes, so it resets on progress. */
const LOAD_STALL_MS = 3 * 60 * 1000;
/** No output for this long while generating counts as a failed request. */
const GENERATE_STALL_MS = 2 * 60 * 1000;
/** Broken WebGPU replies in a row before {@link GenerationEngineDeps.onUnusableGpuOutput} fires. */
const UNUSABLE_STRIKES = 2;

export class GenerationCancelledError extends Error {
	constructor() {
		super("Title generation was cancelled.");
		this.name = "AbortError";
	}
}

export class ModelNotReadyError extends Error {
	constructor(readonly status: EngineStatus["kind"], detail?: string) {
		super(
			status === "disabled"
				? "Local AI is turned off on this device."
				: detail ?? "The AI model is not loaded.",
		);
		this.name = "ModelNotReadyError";
	}
}

/**
 * Owns the title model. It loads in a Worker of its own when something takes a lease
 * ({@link acquire}, or {@link generate} for its duration), and that Worker is terminated once
 * nothing has used the model for {@link GenerationEngineDeps.idleMs}: ending the Worker is the
 * only way to hand back the memory, since a WASM heap never shrinks and GPU buffers go with it.
 *
 * Generations are not queued here: the worker runs them one at a time, interactive lane first.
 */
export class GenerationEngine {
	private state: State = {kind: "unloaded"};
	private leases = 0;
	private idleTimer: number | null = null;
	/** When {@link idleTimer} fires, on the deps' clock. */
	private idleDeadline: number | null = null;
	private requestIdCounter = 0;
	private unusableStrikes = 0;
	private disposed = false;
	private readonly pending = new Map<number, PendingGeneration>();
	private readonly listeners = new Set<(status: EngineStatus) => void>();

	constructor(private readonly deps: GenerationEngineDeps) {
	}

	status(): EngineStatus {
		const state = this.state;
		if (state.kind === "loading") return {kind: "loading", progress: state.progress};
		if (state.kind === "ready") return {kind: "ready", device: state.device, dtype: state.dtype, loadMs: state.loadMs};
		if (state.kind === "error") return {kind: "error", message: state.message, offline: state.offline};
		return {kind: state.kind};
	}

	/** Registers a listener for status changes; it is invoked immediately with the current status. */
	subscribe(listener: (status: EngineStatus) => void): Unsubscribe {
		this.listeners.add(listener);
		listener(this.status());
		return () => {
			this.listeners.delete(listener);
		};
	}

	config(): GenerationModelConfig {
		return this.deps.getConfig();
	}

	/** Whether loading the model now would not need to download it. */
	async isDownloaded(): Promise<boolean> {
		if (this.state.kind === "ready") return true;
		return this.deps.isDownloaded(this.deps.getConfig());
	}

	/**
	 * Keeps the model loaded until the lease is released, loading it first if it isn't. The first
	 * lease after a failure tries again; later ones leave that to {@link retry}.
	 */
	acquire(): ModelLease {
		if (this.disposed) return {release: () => {}};

		this.leases++;
		this.cancelTeardown();
		if (this.state.kind === "unloaded" || (this.state.kind === "error" && this.leases === 1)) this.load();

		let released = false;
		return {
			release: () => {
				if (released) return;
				released = true;
				this.leases--;
				if (this.leases === 0) this.scheduleTeardown();
			},
		};
	}

	/**
	 * Loads the model ahead of use when that won't start a download; the idle countdown then applies.
	 * With no idle time it would unload again as soon as it loaded, so then it doesn't.
	 */
	async prewarm(): Promise<void> {
		if (this.state.kind !== "unloaded") {
			if (this.state.kind === "ready" && this.leases === 0) this.scheduleTeardown();
			return;
		}
		if (this.deps.idleMs() === 0 || !(await this.isDownloaded())) return;
		this.acquire().release();
	}

	/**
	 * When the model unloads by itself if nothing uses it before then, on the deps' clock: null while
	 * it's in use, or not in memory.
	 */
	unloadsAt(): number | null {
		return this.state.kind === "ready" ? this.idleDeadline : null;
	}

	/** Restarts the idle countdown if one is running, so a changed idle time applies to the model loaded now. */
	idleTimeChanged(): void {
		if (this.idleTimer !== null) this.scheduleTeardown();
	}

	/** Resolves once the model is no longer loading (ready, failed, or disabled). */
	async whenSettled(): Promise<void> {
		while (this.state.kind === "loading") await this.state.settled;
	}

	/**
	 * Generates a reply to `request`, loading the model first if needed. Rejects with
	 * {@link GenerationCancelledError} when `signal` aborts, which also stops the worker's work.
	 */
	async generate(request: GenerationRequest, options: GenerateOptions): Promise<GenerationResult> {
		const lease = this.acquire();
		try {
			if (options.signal?.aborted) throw new GenerationCancelledError();
			await this.whenSettled();
			if (options.signal?.aborted) throw new GenerationCancelledError();

			const state = this.state;
			if (state.kind !== "ready") {
				throw new ModelNotReadyError(state.kind, state.kind === "error" ? state.message : undefined);
			}
			const result = await this.request(state, request, options);
			this.checkUsable(state, result);
			return result;
		} finally {
			lease.release();
		}
	}

	/** Tries loading again after a failure. */
	retry(): void {
		if (this.state.kind !== "error") return;
		this.state = {kind: "unloaded"};
		this.notify();
		if (this.leases > 0) this.load();
	}

	/**
	 * Loads the model so its weights are on this device, then lets it go idle. Resolves once it's
	 * ready; rejects if it failed, or was unloaded or disabled before it got there.
	 */
	async download(): Promise<void> {
		const lease = this.acquire();
		try {
			await this.whenSettled();
		} finally {
			lease.release();
		}
		const status = this.status();
		if (status.kind !== "ready") throw new Error(status.kind === "error" ? status.message : "The download was stopped.");
	}

	/** Stops the model now, a download included, whoever uses it; the next use loads it again. */
	unload(): void {
		const state = this.state;
		if (state.kind !== "loading" && state.kind !== "ready") return;
		this.stop(state, new Error("The AI model was unloaded."));
		this.cancelTeardown();
		this.state = {kind: "unloaded"};
		this.notify();
	}

	/** Unloads the model and loads it again if it's in use, e.g. after switching to the CPU backend. */
	reload(): void {
		const state = this.state;
		if (state.kind !== "loading" && state.kind !== "ready") return;
		this.unload();
		if (this.leases > 0) this.load();
	}

	/** Unloads the model and keeps it unloaded until {@link enable}, whatever asks for it. */
	disable(): void {
		if (this.disposed || this.state.kind === "disabled") return;
		const state = this.state;
		if (state.kind === "loading" || state.kind === "ready") this.stop(state, new ModelNotReadyError("disabled"));
		this.cancelTeardown();
		this.state = {kind: "disabled"};
		this.notify();
	}

	enable(): void {
		if (this.disposed || this.state.kind !== "disabled") return;
		this.state = {kind: "unloaded"};
		this.notify();
		if (this.leases > 0) this.load();
	}

	/** Terminates the model's worker for good, e.g. when the plugin unloads. */
	dispose(): void {
		this.disposed = true;
		this.cancelTeardown();
		const state = this.state;
		if (state.kind === "loading" || state.kind === "ready") this.stop(state, new Error("The AI model was unloaded."));
		this.state = {kind: "unloaded"};
		this.listeners.clear();
	}

	private load(): void {
		const config = this.deps.getConfig();
		let settle!: () => void;
		const settled = new Promise<void>((resolve) => {
			settle = resolve;
		});
		const worker = this.deps.startWorker();
		worker.addEventListener("message", (event: MessageEvent<WorkerResponse>) => this.onMessage(worker, event.data));
		worker.addEventListener("error", (event: ErrorEvent) => this.fail(worker, `The AI model crashed: ${event.message}`));

		const expectedBytes = config.downloadBytes[config.dtype.webgpu] ?? 0;
		const loading: Loading = {
			kind: "loading",
			worker,
			progress: null,
			tracker: new DownloadProgress(expectedBytes, MIN_DOWNLOAD_PROGRESS_BYTES),
			stallTimer: null,
			settled,
			settle,
		};
		this.state = loading;
		this.armLoadStall(loading);
		this.notify();
		this.post(worker, {
			type: "init",
			config,
			allowWebGpu: this.deps.allowWebGpu,
			forceWasm: this.deps.isForceWasm(),
			cacheKey: this.deps.cacheKey,
		});
	}

	private armLoadStall(loading: Loading): void {
		if (loading.stallTimer !== null) window.clearTimeout(loading.stallTimer);
		loading.stallTimer = window.setTimeout(() => {
			this.fail(loading.worker, `The ${this.deps.getConfig().label} model did not finish loading. Check your internet connection and try again.`);
		}, LOAD_STALL_MS);
	}

	private onMessage(worker: Worker, message: WorkerResponse): void {
		const state = this.state;
		if (!("worker" in state) || state.worker !== worker) return;

		if (message.type === "load-progress") {
			if (state.kind !== "loading") return;
			this.armLoadStall(state);
			const progress = state.tracker.update(message);
			if (progress === null || progress === state.progress) return;
			state.progress = progress;
			this.notify();
			return;
		}

		if (message.type === "ready") {
			if (state.kind !== "loading") return;
			if (state.stallTimer !== null) window.clearTimeout(state.stallTimer);
			this.state = {kind: "ready", worker, device: message.device, dtype: message.dtype, loadMs: message.loadMs};
			this.notify();
			state.settle();
			if (this.leases === 0) this.scheduleTeardown();
			return;
		}

		if (message.type === "load-error") {
			this.fail(worker, message.message, message.offline);
			return;
		}

		const pending = this.pending.get(message.requestId);
		if (!pending) return;

		if (message.type === "delta") {
			pending.armStall();
			pending.onDelta?.(message.text);
			return;
		}

		this.pending.delete(message.requestId);
		pending.cleanup();
		if (message.type === "result") pending.resolve({text: message.text, stats: message.stats});
		else if (message.type === "cancelled") pending.reject(new GenerationCancelledError());
		else pending.reject(new Error(`The AI model failed: ${message.message}`));
	}

	/** Ends a worker that failed. The error stays on show until the next lease (or {@link retry}) loads again. */
	private fail(worker: Worker, message: string, offline = typeof navigator !== "undefined" && !navigator.onLine): void {
		const state = this.state;
		if (!("worker" in state) || state.worker !== worker) return;
		this.stop(state, new Error(message));
		this.state = {kind: "error", message, offline};
		this.notify();
	}

	/** Terminates the worker, failing whatever was still waiting on it. */
	private stop(state: Loading | Ready, reason: Error): void {
		state.worker.terminate();
		for (const pending of this.pending.values()) {
			pending.cleanup();
			pending.reject(reason);
		}
		this.pending.clear();
		if (state.kind === "loading") {
			if (state.stallTimer !== null) window.clearTimeout(state.stallTimer);
			state.settle();
		}
	}

	private request(state: Ready, request: GenerationRequest, options: GenerateOptions): Promise<GenerationResult> {
		const requestId = this.requestIdCounter++;
		const {signal} = options;

		return new Promise<GenerationResult>((resolve, reject) => {
			let stallTimer: number | null = null;
			const armStall = () => {
				if (stallTimer !== null) window.clearTimeout(stallTimer);
				stallTimer = window.setTimeout(() => {
					if (!this.pending.delete(requestId)) return;
					cleanup();
					this.post(state.worker, {type: "cancel", requestId});
					reject(new Error("The AI model stopped responding."));
				}, GENERATE_STALL_MS);
			};
			const onAbort = () => {
				// The worker answers a cancel with `cancelled`, which settles this request.
				this.post(state.worker, {type: "cancel", requestId});
			};
			const cleanup = () => {
				if (stallTimer !== null) window.clearTimeout(stallTimer);
				signal?.removeEventListener("abort", onAbort);
			};

			signal?.addEventListener("abort", onAbort, {once: true});
			this.pending.set(requestId, {resolve, reject, onDelta: options.onDelta, armStall, cleanup});
			armStall();
			this.post(state.worker, {type: "generate", requestId, lane: options.lane, ...request});
		});
	}

	/** Counts broken-looking WebGPU replies; enough in a row and the caller hears about it. */
	private checkUsable(state: Ready, result: GenerationResult): void {
		if (state.device !== "webgpu" || result.stats.stoppedBy === "cancel") return;
		if (!looksUnusable(result.text, parseList(result.text).length, result.stats.outputTokens)) {
			this.unusableStrikes = 0;
			return;
		}
		if (++this.unusableStrikes < UNUSABLE_STRIKES) return;
		this.unusableStrikes = 0;
		this.deps.onUnusableGpuOutput?.();
	}

	private post(worker: Worker, message: WorkerRequest): void {
		worker.postMessage(message);
	}

	private scheduleTeardown(): void {
		this.cancelTeardown();
		if (this.disposed) return;
		const idleMs = this.deps.idleMs();
		this.idleDeadline = (this.deps.now ?? Date.now)() + idleMs;
		this.idleTimer = window.setTimeout(() => {
			this.idleTimer = null;
			this.idleDeadline = null;
			this.teardown();
		}, idleMs);
	}

	private cancelTeardown(): void {
		if (this.idleTimer !== null) window.clearTimeout(this.idleTimer);
		this.idleTimer = null;
		this.idleDeadline = null;
	}

	private teardown(): void {
		if (this.leases > 0) return;
		const state = this.state;

		// A download cut short starts over next time: let it finish, then wait out the idle time again.
		if (state.kind === "loading") {
			void state.settled.then(() => {
				if (this.leases === 0) this.scheduleTeardown();
			});
			return;
		}

		if (state.kind !== "ready") return;
		this.stop(state, new Error("The AI model was unloaded."));
		this.state = {kind: "unloaded"};
		this.notify();
	}

	private notify(): void {
		const status = this.status();
		for (const listener of this.listeners) {
			try {
				listener(status);
			} catch (error) {
				console.error("[Titler] Engine status listener failed:", error);
			}
		}
	}
}
