import {
	AutoModelForCausalLM,
	AutoTokenizer,
	env,
	InterruptableStoppingCriteria,
	PreTrainedModel,
	PreTrainedTokenizer,
	ProgressInfo,
	Tensor,
	TextStreamer,
} from "@huggingface/transformers";
import { ChatMessage, Device, DType, GenerationModelConfig } from "../../types";
import { createListStream } from "../../core/title/parse";
import { GenerationRequest, StopReason } from "../protocol";
import { Backend, BackendResult, GenerateHooks, LoadedModel } from "./handlers";

env.allowLocalModels = false;

const cacheKeyFor = (repoId: string, file: string) => `https://huggingface.co/${repoId}/resolve/main/${file}`;

type TransformersModel = LoadedModel & {
	config: GenerationModelConfig;
	tokenizer: PreTrainedTokenizer;
	model: PreTrainedModel;
	/** Every token that ends the assistant's turn: the repo's EOS ids plus the config's stop tokens. */
	eosTokenIds: number[];
};

type Variant = {device: Device; dtype: DType};

type GpuAdapterLike = {features: {has(feature: string): boolean}};
type GpuLike = {requestAdapter(): Promise<GpuAdapterLike | null>};

/**
 * `navigator.gpu` being defined only means the WebGPU API exists, not that a GPU adapter is
 * actually obtainable. Requesting the adapter is the only way to know, and doubles as the
 * shader-f16 check (needed for q4f16 weights), since that also needs an adapter.
 */
async function detectWebGpu(): Promise<{available: boolean; f16: boolean}> {
	const gpu = (navigator as Navigator & {gpu?: GpuLike}).gpu;
	if (gpu == null) return {available: false, f16: false};
	try {
		const adapter = await gpu.requestAdapter();
		if (adapter == null) return {available: false, f16: false};
		return {available: true, f16: adapter.features.has("shader-f16")};
	} catch {
		return {available: false, f16: false};
	}
}

/** Whether every weight file of `dtype` is in the cache, so loading won't need the network. */
async function isModelCached(config: GenerationModelConfig, dtype: DType, cacheKey: string): Promise<boolean> {
	if (typeof caches === "undefined") return true;
	try {
		const cache = await caches.open(cacheKey);
		for (const file of config.weightFiles[dtype] ?? []) {
			if (!(await cache.match(cacheKeyFor(config.repoId, file)))) return false;
		}
		return true;
	} catch {
		return true;
	}
}

function describeLoadFailure(error: unknown, config: GenerationModelConfig): string {
	const detail = error instanceof Error ? error.message : String(error);
	const looksLikeNetwork = !navigator.onLine || /failed to fetch|network|load model file/i.test(detail);
	if (looksLikeNetwork) {
		return `Could not download the ${config.label} model. Check your internet connection and try again.`;
	}
	return `Could not load the ${config.label} model: ${detail}`;
}

function stopTokenIds(model: PreTrainedModel, tokenizer: PreTrainedTokenizer, config: GenerationModelConfig): number[] {
	const ids = new Set<number>();
	const configured = (model.generation_config as {eos_token_id?: number | number[]} | null)?.eos_token_id ?? tokenizer.eos_token_id;
	for (const id of [configured].flat()) {
		if (typeof id === "number") ids.add(id);
	}
	const vocab = tokenizer.get_vocab();
	for (const token of config.stopTokens) {
		const id = vocab.get(token);
		if (id !== undefined) ids.add(id);
	}
	return [...ids];
}

/**
 * Lets queued messages (a cancel) in. Inference only awaits microtasks, so without this a cancel
 * would wait out the whole generation. A message rather than a timer, which a hidden window throttles.
 */
function yieldToMessages(): Promise<void> {
	return new Promise((resolve) => {
		const channel = new MessageChannel();
		channel.port1.onmessage = () => {
			channel.port1.close();
			resolve();
		};
		channel.port2.postMessage(null);
	});
}

async function load(
	config: GenerationModelConfig,
	{allowWebGpu, forceWasm, cacheKey}: {allowWebGpu: boolean; forceWasm: boolean; cacheKey: string},
	onProgress: (progress: {file: string; loaded: number; total: number}) => void,
): Promise<TransformersModel> {
	env.cacheKey = cacheKey;

	const gpu = allowWebGpu && !forceWasm ? await detectWebGpu() : {available: false, f16: false};
	const wasm: Variant = {device: "wasm", dtype: config.dtype.wasm};
	const preferred: Variant = gpu.available
		? {device: "webgpu", dtype: gpu.f16 ? config.dtype.webgpu : config.dtype.webgpuNoF16}
		: wasm;

	if (preferred.device === "wasm" && !config.wasmSupported) {
		throw new Error(`The ${config.label} model needs a GPU, and none is available on this device.`);
	}
	if (!navigator.onLine && !(await isModelCached(config, preferred.dtype, cacheKey))) {
		throw new Error(
			`The ${config.label} model has not been downloaded yet, and you appear to be offline. `
			+ "Connect to the internet to finish setting up.",
		);
	}

	const progress_callback = (info: ProgressInfo) => {
		if (info.status === "progress") onProgress({file: info.file, loaded: info.loaded, total: info.total});
	};
	const loadModel = (variant: Variant) => AutoModelForCausalLM.from_pretrained(config.repoId, {
		device: variant.device,
		dtype: variant.dtype,
		progress_callback,
	});

	try {
		const tokenizer = await AutoTokenizer.from_pretrained(config.repoId, {progress_callback});
		let variant = preferred;
		let model: PreTrainedModel;
		try {
			model = await loadModel(preferred);
		} catch (error) {
			if (preferred.device !== "webgpu" || !config.wasmSupported) throw error;
			console.warn(`[Titler] WebGPU backend failed to load the ${config.label} model; falling back to WASM.`, error);
			variant = wasm;
			model = await loadModel(wasm);
		}
		return {config, tokenizer, model, device: variant.device, dtype: variant.dtype, eosTokenIds: stopTokenIds(model, tokenizer, config)};
	} catch (error) {
		throw new Error(describeLoadFailure(error, config));
	}
}

/** The request's messages with the note filled in, cut to the model's token budget. */
function fillNote({messages, note}: GenerationRequest, tokenizer: PreTrainedTokenizer, maxTokens: number): ChatMessage[] {
	const ids = tokenizer.encode(note.text, {add_special_tokens: false});
	const text = ids.length > maxTokens
		? tokenizer.decode(ids.slice(0, maxTokens), {skip_special_tokens: true})
		: note.text;
	return messages.map((message) => ({...message, content: message.content.split(note.marker).join(text)}));
}

async function generate(loaded: TransformersModel, request: GenerationRequest, hooks: GenerateHooks): Promise<BackendResult> {
	const {config, tokenizer, model} = loaded;
	const startedAt = performance.now();

	const inputs = tokenizer.apply_chat_template(fillNote(request, tokenizer, config.maxInputTokens), {
		add_generation_prompt: true,
		return_dict: true,
		// Extra keys reach the template as variables (e.g. enable_thinking); the typings don't list them.
		...config.chatTemplateKwargs,
	}) as unknown as {input_ids: Tensor; attention_mask: Tensor};
	const inputTokens = inputs.input_ids.dims.at(-1) ?? 0;

	const stopping = new InterruptableStoppingCriteria();
	const list = createListStream();
	let text = "";
	let outputTokens = 0;
	let firstTokenAt: number | null = null;
	let stoppedBy: StopReason | null = null;

	const streamer = new TextStreamer(tokenizer, {
		skip_prompt: true,
		skip_special_tokens: true,
		callback_function: (piece: string) => {
			text += piece;
			hooks.onDelta(piece);
			list.push(piece);
			if (list.count >= request.params.stopAfterItems && stoppedBy === null) {
				stoppedBy = "list-complete";
				stopping.interrupt();
			}
		},
		token_callback_function: () => {
			outputTokens++;
			firstTokenAt ??= performance.now();
		},
	});

	// Every step of generate() awaits forward(): yielding first lets a cancel message arrive mid-generation.
	const forward = model.forward.bind(model) as (modelInputs: Record<string, unknown>) => Promise<unknown>;
	model.forward = async (modelInputs: Record<string, unknown>) => {
		await yieldToMessages();
		if (hooks.isCancelled() && stoppedBy === null) {
			stoppedBy = "cancel";
			stopping.interrupt();
		}
		return forward(modelInputs);
	};
	const sampling = request.params.sample ? config.sampling : null;
	try {
		await model.generate({
			...inputs,
			max_new_tokens: request.params.maxNewTokens,
			do_sample: sampling !== null,
			...(sampling && {temperature: sampling.temperature, top_p: sampling.topP, top_k: sampling.topK}),
			repetition_penalty: 1,
			eos_token_id: loaded.eosTokenIds,
			stopping_criteria: [stopping],
			streamer,
		});
	} finally {
		model.forward = forward;
	}

	const endedAt = performance.now();
	return {
		text,
		stats: {
			inputTokens,
			outputTokens,
			ttftMs: (firstTokenAt ?? endedAt) - startedAt,
			totalMs: endedAt - startedAt,
			stoppedBy: stoppedBy ?? (outputTokens >= request.params.maxNewTokens ? "max-tokens" : "eos"),
			device: loaded.device,
		},
	};
}

export const transformersBackend: Backend<TransformersModel> = {load, generate};
