const test = require("node:test");
const assert = require("node:assert");

const {createHandlers} = require("../dist/generation/worker/handlers.js");

const CONFIG = {id: "qwen3.5-0.8b", label: "Test model"};
const REQUEST = {messages: [], note: {marker: "{{NOTE}}", text: "note"}, params: {maxNewTokens: 10, stopAfterItems: 3}};

const tick = () => new Promise((resolve) => setImmediate(resolve));

/** A backend whose generations finish only when the test says so, checking for cancellation as a real one does per token. */
function fakeBackend({loadError} = {}) {
	const generations = [];
	return {
		generations,
		load: async () => {
			if (loadError) throw new Error(loadError);
			return {device: "webgpu", dtype: "q4f16"};
		},
		generate: (model, request, hooks) => new Promise((resolve) => {
			const generation = {
				request,
				hooks,
				finish(text = "1. A\n2. B\n3. C") {
					hooks.onDelta(text);
					resolve({text, stats: {inputTokens: 1, outputTokens: 1, ttftMs: 1, totalMs: 1, stoppedBy: hooks.isCancelled() ? "cancel" : "eos", device: model.device}});
				},
			};
			generations.push(generation);
		}),
	};
}

function mount(backend) {
	const posted = [];
	const handle = createHandlers(backend, (message) => posted.push(message));
	return {posted, handle};
}

test("init answers ready with the device; a second init is ignored", async () => {
	const backend = fakeBackend();
	const {posted, handle} = mount(backend);
	const originalError = console.error;
	console.error = () => {};
	try {
		await handle({type: "init", config: CONFIG, allowWebGpu: true, forceWasm: false, cacheKey: "k"});
		await handle({type: "init", config: CONFIG, allowWebGpu: true, forceWasm: false, cacheKey: "k"});
	} finally {
		console.error = originalError;
	}
	const ready = posted.filter((message) => message.type === "ready");
	assert.strictEqual(ready.length, 1);
	assert.strictEqual(ready[0].device, "webgpu");
});

test("a failed load is reported", async () => {
	const {posted, handle} = mount(fakeBackend({loadError: "no weights"}));
	await handle({type: "init", config: CONFIG, allowWebGpu: true, forceWasm: false, cacheKey: "k"});
	assert.strictEqual(posted.at(-1).type, "load-error");
	assert.match(posted.at(-1).message, /no weights/);
});

test("a generation streams deltas and ends with a result that includes queue time", async () => {
	const backend = fakeBackend();
	const {posted, handle} = mount(backend);
	await handle({type: "init", config: CONFIG, allowWebGpu: true, forceWasm: false, cacheKey: "k"});

	const done = handle({type: "generate", requestId: 7, lane: "interactive", ...REQUEST});
	await tick();
	backend.generations[0].finish();
	await done;

	const forRequest = posted.filter((message) => message.requestId === 7);
	assert.deepStrictEqual(forRequest.map((message) => message.type), ["delta", "result"]);
	assert.strictEqual(typeof forRequest[1].stats.queuedMs, "number");
});

test("cancelling a waiting request answers cancelled without running it", async () => {
	const backend = fakeBackend();
	const {posted, handle} = mount(backend);
	await handle({type: "init", config: CONFIG, allowWebGpu: true, forceWasm: false, cacheKey: "k"});

	const first = handle({type: "generate", requestId: 1, lane: "background", ...REQUEST});
	const second = handle({type: "generate", requestId: 2, lane: "background", ...REQUEST});
	await tick();
	await handle({type: "cancel", requestId: 2});
	await second;
	assert.strictEqual(posted.find((message) => message.requestId === 2).type, "cancelled");

	backend.generations[0].finish();
	await first;
	assert.strictEqual(backend.generations.length, 1);
});

test("cancelling the running request makes it stop and answer cancelled, not result", async () => {
	const backend = fakeBackend();
	const {posted, handle} = mount(backend);
	await handle({type: "init", config: CONFIG, allowWebGpu: true, forceWasm: false, cacheKey: "k"});

	const running = handle({type: "generate", requestId: 3, lane: "interactive", ...REQUEST});
	await tick();
	await handle({type: "cancel", requestId: 3});
	assert.strictEqual(backend.generations[0].hooks.isCancelled(), true);

	backend.generations[0].finish("1. Partial");
	await running;
	assert.strictEqual(posted.filter((message) => message.requestId === 3).at(-1).type, "cancelled");
});

test("a cancel after the answer leaves nothing behind", async () => {
	const backend = fakeBackend();
	const {handle} = mount(backend);
	await handle({type: "init", config: CONFIG, allowWebGpu: true, forceWasm: false, cacheKey: "k"});

	const done = handle({type: "generate", requestId: 4, lane: "interactive", ...REQUEST});
	await tick();
	backend.generations[0].finish();
	await done;
	await handle({type: "cancel", requestId: 4});

	const again = handle({type: "generate", requestId: 5, lane: "interactive", ...REQUEST});
	await tick();
	assert.strictEqual(backend.generations[1].hooks.isCancelled(), false);
	backend.generations[1].finish();
	await again;
});
