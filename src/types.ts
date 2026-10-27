export type Casing = "sentence" | "title" | "lower";

export type TitleLength = "short" | "medium" | "long";

export type TitleStyle = "topic" | "claim" | "question";

/** How generated titles should read: what the user picks in settings. */
export type TitleFormat = {
	casing: Casing;
	length: TitleLength;
	style: TitleStyle;
};

export type GenerationModelId = "qwen3.5-2b";

/** Weight precisions the candidate repos ship. `q4f16` needs WebGPU's shader-f16 feature. */
export type DType = "q4f16" | "q4" | "q8" | "fp16" | "fp32";

/** Compute backend a model runs inference on. */
export type Device = "wasm" | "webgpu";

export type ChatMessage = {role: "system" | "user" | "assistant"; content: string};

export type GenerationModelConfig = {
	id: GenerationModelId;
	label: string;
	repoId: string;
	license: string;
	languages: string;
	/** Weights to load per backend. WebGPU without shader-f16 can't run `q4f16`. */
	dtype: {webgpu: DType; webgpuNoF16: DType; wasm: DType};
	/** Whether the CPU (WASM) backend can hold the model at all: wasm32 heaps top out at 4 GB. */
	wasmSupported: boolean;
	/** The weight files each dtype downloads, used to tell whether a model is already on this device. */
	weightFiles: Partial<Record<DType, string[]>>;
	/** Approximate download size per dtype, for the download notice and settings. */
	downloadBytes: Partial<Record<DType, number>>;
	/** Extra variables for the chat template, e.g. `{enable_thinking: false}`. */
	chatTemplateKwargs: Record<string, unknown>;
	/** Tokens that end the assistant's turn, when the repo's generation config doesn't list them as EOS. */
	stopTokens: string[];
	/** The note is cut to this many tokens before it goes into the prompt. */
	maxInputTokens: number;
	/** How to sample when asked for different titles than before; otherwise generation is greedy. */
	sampling: {temperature: number; topP: number; topK: number};
};

export interface TitlerSettings {
	autoTitle: boolean;
	casing: Casing;
	length: TitleLength;
	style: TitleStyle;
	/** Words a note needs before it is named automatically. */
	minWords: number;
	advancedOpen: boolean;
	/** Not shown in settings: kept so the model can change in a later version without a migration. */
	modelId: GenerationModelId;
}

/**
 * Settings that belong to one device and must never follow the vault to another
 * (via Obsidian Sync, iCloud, git, …). Persisted in localStorage, not data.json.
 */
export interface DeviceSettings {
	modelDisabled: boolean;
	/** Set when WebGPU produced unusable output on this device: the CPU backend is used instead. */
	forceWasm: boolean;
	/** How long the model stays in memory after it was last used. 0 unloads it as soon as it's done. */
	unloadAfterSeconds: number;
}

export interface TitlerPluginData {
	settings: TitlerSettings;
}
