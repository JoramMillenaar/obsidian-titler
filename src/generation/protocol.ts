import { ChatMessage, Device, DType, GenerationModelConfig } from "../types";

/**
 * Which queue a request waits in. Interactive work (titles for a popup the user is looking at)
 * runs before background work (naming an Untitled note) whenever the worker picks the next request.
 */
export type Lane = "interactive" | "background";

export type GenerationParams = {
	maxNewTokens: number;
	/** Stop as soon as the reply holds this many list items, instead of waiting for the model to end its turn. */
	stopAfterItems: number;
};

export type GenerationRequest = {
	messages: ChatMessage[];
	/** The note's text, which replaces `marker` in the messages after it is cut to the model's token budget. */
	note: {marker: string; text: string};
	params: GenerationParams;
};

export type StopReason = "eos" | "max-tokens" | "list-complete" | "cancel";

export type GenerationStats = {
	inputTokens: number;
	outputTokens: number;
	/** Time spent waiting behind other requests in the worker. */
	queuedMs: number;
	/** Time from starting this request to its first output token: mostly reading the prompt. */
	ttftMs: number;
	/** Time from starting this request to its end, queueing excluded. */
	totalMs: number;
	stoppedBy: StopReason;
	device: Device;
};

export type GenerationResult = {text: string; stats: GenerationStats};

export type ModelLoadProgress = {
	file: string;
	loaded: number;
	total: number;
};

/** Messages the host sends to the model worker. There is no dispose: terminating the worker is what frees its memory. */
export type WorkerRequest =
	| {type: "init"; config: GenerationModelConfig; allowWebGpu: boolean; forceWasm: boolean; cacheKey: string}
	| ({type: "generate"; requestId: number; lane: Lane} & GenerationRequest)
	| {type: "cancel"; requestId: number};

/** Messages the model worker posts back. Every generate request gets exactly one of result, error or cancelled. */
export type WorkerResponse =
	| ({type: "load-progress"} & ModelLoadProgress)
	| {type: "load-error"; message: string; offline: boolean}
	| {type: "ready"; device: Device; dtype: DType; loadMs: number}
	| {type: "delta"; requestId: number; text: string}
	| {type: "result"; requestId: number; text: string; stats: GenerationStats}
	| {type: "error"; requestId: number; message: string}
	| {type: "cancelled"; requestId: number};
