import {
	Casing,
	DeviceSettings,
	GenerationModelConfig,
	GenerationModelId,
	TitleLength,
	TitlerSettings,
	TitleStyle,
} from "./types";

// No `obsidian` imports here: the model worker bundles this file.

/** Cache Storage bucket for model weights and ONNX Runtime binaries, kept apart from other plugins'. */
export const MODEL_CACHE_KEY = "titler-models";

/** Download progress for files smaller than this (configs, tokenizers) is not worth showing. */
export const MIN_DOWNLOAD_PROGRESS_BYTES = 1_000_000;

/** The longest the model may stay in memory after it was last used: a day. Unloading terminates its worker. */
export const MAX_UNLOAD_AFTER_SECONDS = 24 * 60 * 60;

/** How many titles one generation asks for. */
export const TITLE_COUNT = 3;

/**
 * How many titles asking for more asks for: some repeat ones already shown, so a few extra, and
 * the reply stops once TITLE_COUNT new ones are in.
 */
export const MORE_TITLE_COUNT = 5;

/**
 * Words of actual text (frontmatter, code, links and embeds don't count) a note needs before titles
 * are suggested for it: with fewer, the model has nothing to go on and makes something up.
 */
export const MIN_TITLE_WORDS = 5;

/** The note text is cut to this many characters before the worker cuts it to the model's token budget. */
export const MAX_PROMPT_CHARS = 6000;

/** Longest file name a title may become, in characters. */
export const MAX_TITLE_CHARS = 100;

export const GENERATION_MODELS: Record<GenerationModelId, GenerationModelConfig> = {
	"qwen3.5-2b": {
		id: "qwen3.5-2b",
		label: "Qwen3.5 2B",
		// The -OPT export: its linear attention uses fused LinearAttention/CausalConvWithState ops. The
		// plain Qwen3.5-2B-ONNX export runs it as a token-by-token Scan loop that WebGPU can't take,
		// so reading a note took ~40 s there instead of under one.
		repoId: "onnx-community/Qwen3.5-2B-ONNX-OPT",
		license: "Apache 2.0",
		languages: "201 languages",
		dtype: {webgpu: "q4f16", webgpuNoF16: "q4", wasm: "q4"},
		wasmSupported: true,
		weightFiles: {
			q4f16: ["onnx/decoder_model_merged_q4f16.onnx_data", "onnx/embed_tokens_q4f16.onnx_data"],
			q4: ["onnx/decoder_model_merged_q4.onnx_data", "onnx/embed_tokens_q4.onnx_data"],
		},
		downloadBytes: {q4f16: 1_383_000_000, q4: 1_533_000_000},
		chatTemplateKwargs: {enable_thinking: false},
		stopTokens: ["<|im_end|>"],
		maxInputTokens: 1200,
		// Qwen's recommended settings for answering without thinking.
		sampling: {temperature: 0.7, topP: 0.8, topK: 20},
	},
};

/**
 * Picked with the title bench (src/dev/bench) on real notes, English and Dutch, against Qwen3.5 0.8B,
 * LFM2.5 350M/1.2B and Gemma 4 E2B: three good titles for every note, in the note's language, in
 * about a second on WebGPU, at half Gemma's download.
 */
export const DEFAULT_MODEL_ID: GenerationModelId = "qwen3.5-2b";

export const TITLE_CASINGS: {id: Casing; label: string}[] = [
	{id: "sentence", label: "Sentence case"},
	{id: "title", label: "Title Case"},
	{id: "lower", label: "lowercase"},
];

export const TITLE_LENGTHS: Record<TitleLength, {label: string; minWords: number; maxWords: number; maxNewTokens: number}> = {
	short: {label: "Short (2–4 words)", minWords: 2, maxWords: 4, maxNewTokens: 48},
	medium: {label: "Medium (4–8 words)", minWords: 4, maxWords: 8, maxNewTokens: 72},
	long: {label: "Descriptive (8–12 words)", minWords: 8, maxWords: 12, maxNewTokens: 96},
};

export const TITLE_STYLES: Record<TitleStyle, {label: string; example: string}> = {
	topic: {label: "Topic", example: "Sourdough starter care"},
	claim: {label: "Claim", example: "Starters need daily feeding at room temperature"},
	question: {label: "Question", example: "How often should I feed a starter"},
};

export const DEFAULT_SETTINGS: TitlerSettings = {
	autoTitle: true,
	casing: "sentence",
	length: "medium",
	style: "topic",
	minWords: 30,
	advancedOpen: false,
	modelId: DEFAULT_MODEL_ID,
};

export const DEFAULT_DEVICE_SETTINGS: DeviceSettings = {
	modelDisabled: false,
	forceWasm: false,
	unloadAfterSeconds: 10 * 60,
};

export const DEVICE_SETTINGS_STORAGE_KEY = "titler:device-settings";

export const REPO_URL = "https://github.com/JoramMillenaar/obsidian-titler";

/** How long typing has to pause before an Untitled note is named. */
export const AUTO_TITLE_PAUSE_MS = 5000;
