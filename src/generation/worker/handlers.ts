import { Device, DType, GenerationModelConfig } from "../../types";
import { GenerationRequest, GenerationStats, ModelLoadProgress, WorkerRequest, WorkerResponse } from "../protocol";
import { CancelledError, LaneQueue } from "./queue";

export type LoadOptions = {allowWebGpu: boolean; forceWasm: boolean; cacheKey: string};

export type GenerateHooks = {
	onDelta: (text: string) => void;
	/** Checked between tokens: true stops the generation at the next one. */
	isCancelled: () => boolean;
};

export type LoadedModel = {device: Device; dtype: DType};

/** A finished generation as the backend reports it; the worker adds the time it spent queued. */
export type BackendResult = {text: string; stats: Omit<GenerationStats, "queuedMs">};

/** What the worker needs from the model library; model.ts is the real one, tests pass a fake. */
export type Backend<M extends LoadedModel = LoadedModel> = {
	load(config: GenerationModelConfig, options: LoadOptions, onProgress: (progress: ModelLoadProgress) => void): Promise<M>;
	generate(model: M, request: GenerationRequest, hooks: GenerateHooks): Promise<BackendResult>;
};

type Post = (message: WorkerResponse) => void;

function message(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

/**
 * The worker's side of the protocol: loads the model once, then runs generate requests one at a
 * time through a {@link LaneQueue}. A cancel removes a waiting request, or makes the running one
 * stop at its next token; either way the host gets a `cancelled` reply.
 */
export function createHandlers<M extends LoadedModel>(backend: Backend<M>, post: Post): (request: WorkerRequest) => Promise<void> {
	let loading: Promise<M> | null = null;
	const queue = new LaneQueue();
	const cancelled = new Set<number>();

	async function init(request: WorkerRequest & {type: "init"}): Promise<void> {
		if (loading) {
			console.error("[Titler] Model worker received a second 'init' message; ignoring it.");
			return;
		}
		const startedAt = performance.now();
		loading = backend.load(request.config, request, (progress) => post({type: "load-progress", ...progress}));
		try {
			const model = await loading;
			post({type: "ready", device: model.device, dtype: model.dtype, loadMs: performance.now() - startedAt});
		} catch (error) {
			post({type: "load-error", message: message(error), offline: typeof navigator !== "undefined" && !navigator.onLine});
		}
	}

	async function generate(request: WorkerRequest & {type: "generate"}): Promise<void> {
		const {requestId} = request;
		const queuedAt = performance.now();
		try {
			const result = await queue.run(requestId, request.lane, async () => {
				if (!loading) throw new Error("The model has not been initialized.");
				const model = await loading;
				const queuedMs = performance.now() - queuedAt;
				const outcome = await backend.generate(model, request, {
					onDelta: (text) => post({type: "delta", requestId, text}),
					isCancelled: () => cancelled.has(requestId),
				});
				return {...outcome, stats: {...outcome.stats, queuedMs}};
			});
			if (cancelled.has(requestId)) post({type: "cancelled", requestId});
			else post({type: "result", requestId, text: result.text, stats: result.stats});
		} catch (error) {
			if (error instanceof CancelledError || cancelled.has(requestId)) post({type: "cancelled", requestId});
			else post({type: "error", requestId, message: message(error)});
		} finally {
			cancelled.delete(requestId);
		}
	}

	function cancel(request: WorkerRequest & {type: "cancel"}): void {
		// A waiting request is rejected by the queue; a running one sees the flag at its next token.
		if (queue.cancel(request.requestId)) return;
		if (queue.isRunning(request.requestId)) cancelled.add(request.requestId);
	}

	return async (request) => {
		if (request.type === "init") return init(request);
		if (request.type === "generate") return generate(request);
		if (request.type === "cancel") cancel(request);
	};
}
