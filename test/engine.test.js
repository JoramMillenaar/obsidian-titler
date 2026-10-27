const test = require("node:test");
const assert = require("node:assert");

/** Manual clock, so idle and stall deadlines are testable in milliseconds. */
function makeClock() {
	let now = 0;
	let seq = 0;
	const timers = new Map();

	const flushMicrotasks = () => new Promise((resolve) => setImmediate(resolve));

	return {
		setTimeout(fn, ms) {
			const id = ++seq;
			timers.set(id, {at: now + (ms || 0), fn});
			return id;
		},
		clearTimeout(id) {
			timers.delete(id);
		},
		async advance(ms) {
			const target = now + ms;
			for (;;) {
				let due = null;
				for (const [id, timer] of timers) {
					if (timer.at <= target && (due === null || timer.at < due.timer.at)) due = {id, timer};
				}
				if (!due) break;
				timers.delete(due.id);
				now = due.timer.at;
				due.timer.fn();
				await flushMicrotasks();
			}
			now = target;
			await flushMicrotasks();
		},
		flushMicrotasks,
		now: () => now,
	};
}

const clock = makeClock();
global.window = {setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout};

const {GenerationCancelledError, GenerationEngine, ModelNotReadyError} = require("../dist/generation/engine.js");

const CONFIG = {
	id: "qwen3.5-0.8b",
	label: "Test model",
	dtype: {webgpu: "q4f16", webgpuNoF16: "q4", wasm: "q4"},
	downloadBytes: {q4f16: 10_000_000},
};
const REQUEST = {messages: [], note: {marker: "{{NOTE}}", text: "note"}, params: {maxNewTokens: 10, stopAfterItems: 3}};
const IDLE_MS = 60_000;
const STATS = {inputTokens: 1, outputTokens: 1, queuedMs: 0, ttftMs: 1, totalMs: 1, stoppedBy: "eos", device: "webgpu"};

/**
 * A worker whose replies the test plays back. By default `init` is answered with `ready` and
 * `generate` with a delta and a result, the way a working model worker behaves.
 */
class FakeWorker {
	constructor(behaviour) {
		this.behaviour = behaviour;
		this.listeners = {message: [], error: []};
		this.sent = [];
		this.terminated = false;
	}

	postMessage(message) {
		this.sent.push(message);
		this.behaviour(message, this);
	}

	addEventListener(type, fn) {
		this.listeners[type].push(fn);
	}

	deliver(data) {
		for (const listener of [...this.listeners.message]) listener({data});
	}

	crash(message) {
		for (const listener of [...this.listeners.error]) listener({message});
	}

	terminate() {
		this.terminated = true;
	}
}

function workingModel(message, worker, {text = "1. A\n2. B\n3. C", device = "webgpu"} = {}) {
	if (message.type === "init") {
		worker.deliver({type: "ready", device, dtype: "q4f16", loadMs: 5});
		return;
	}
	if (message.type === "generate") {
		worker.deliver({type: "delta", requestId: message.requestId, text});
		worker.deliver({type: "result", requestId: message.requestId, text, stats: {...STATS, device}});
	}
	if (message.type === "cancel") {
		worker.deliver({type: "cancelled", requestId: message.requestId});
	}
}

function makeEngine({behaviour = workingModel, downloaded = true, onUnusableGpuOutput, idleMs = () => IDLE_MS} = {}) {
	const workers = [];
	const engine = new GenerationEngine({
		getConfig: () => CONFIG,
		startWorker: () => {
			const worker = new FakeWorker(behaviour);
			workers.push(worker);
			return worker;
		},
		allowWebGpu: true,
		isForceWasm: () => false,
		isDownloaded: async () => downloaded,
		cacheKey: "test-cache",
		idleMs,
		onUnusableGpuOutput,
		now: clock.now,
	});
	return {engine, workers};
}

test("generating loads the model, streams its reply and returns the result", async () => {
	const {engine, workers} = makeEngine();
	const deltas = [];

	const result = await engine.generate(REQUEST, {lane: "interactive", onDelta: (text) => deltas.push(text)});

	assert.strictEqual(workers.length, 1);
	assert.deepStrictEqual(workers[0].sent.map((message) => message.type), ["init", "generate"]);
	assert.strictEqual(workers[0].sent[1].lane, "interactive");
	assert.deepStrictEqual(deltas, ["1. A\n2. B\n3. C"]);
	assert.strictEqual(result.text, "1. A\n2. B\n3. C");
	assert.strictEqual(engine.status().kind, "ready");
	engine.dispose();
});

test("the model is unloaded once idle, and the next use loads it again", async () => {
	const {engine, workers} = makeEngine();
	await engine.generate(REQUEST, {lane: "background"});

	await clock.advance(IDLE_MS - 1);
	assert.strictEqual(workers[0].terminated, false);
	await clock.advance(1);
	assert.strictEqual(workers[0].terminated, true);
	assert.strictEqual(engine.status().kind, "unloaded");

	await engine.generate(REQUEST, {lane: "background"});
	assert.strictEqual(workers.length, 2);
	engine.dispose();
});

test("the engine tells when an idle model will unload, and that a model in use won't", async () => {
	const {engine} = makeEngine();
	assert.strictEqual(engine.unloadsAt(), null, "not loaded");
	await engine.generate(REQUEST, {lane: "background"});
	const deadline = clock.now() + IDLE_MS;
	assert.strictEqual(engine.unloadsAt(), deadline);

	const lease = engine.acquire();
	assert.strictEqual(engine.unloadsAt(), null, "in use");
	await clock.advance(1000);
	lease.release();
	assert.strictEqual(engine.unloadsAt(), clock.now() + IDLE_MS, "counts again from when it was last used");

	engine.unload();
	assert.strictEqual(engine.unloadsAt(), null, "unloaded by hand");
	engine.dispose();
});

test("a held lease keeps the model loaded past the idle time", async () => {
	const {engine, workers} = makeEngine();
	const lease = engine.acquire();
	await engine.whenSettled();

	await clock.advance(IDLE_MS * 3);
	assert.strictEqual(workers[0].terminated, false);

	lease.release();
	lease.release();
	await clock.advance(IDLE_MS);
	assert.strictEqual(workers[0].terminated, true);
	engine.dispose();
});

test("a changed idle time restarts the countdown of an idle model, and leaves a model in use alone", async () => {
	let idleMs = IDLE_MS;
	const {engine, workers} = makeEngine({idleMs: () => idleMs});
	await engine.generate(REQUEST, {lane: "background"});

	await clock.advance(IDLE_MS / 2);
	idleMs = 1000;
	engine.idleTimeChanged();
	await clock.advance(999);
	assert.strictEqual(workers[0].terminated, false);
	await clock.advance(1);
	assert.strictEqual(workers[0].terminated, true, "the new idle time counts from the change");

	const lease = engine.acquire();
	await engine.whenSettled();
	engine.idleTimeChanged();
	await clock.advance(idleMs * 3);
	assert.strictEqual(workers[1].terminated, false, "a held lease still keeps it loaded");
	lease.release();
	engine.dispose();
});

test("with no idle time the model unloads as soon as it's done, and prewarming leaves it unloaded", async () => {
	const {engine, workers} = makeEngine({idleMs: () => 0});
	await engine.generate(REQUEST, {lane: "background"});
	assert.strictEqual(workers[0].terminated, false);
	await clock.advance(0);
	assert.strictEqual(workers[0].terminated, true);

	await engine.prewarm();
	assert.strictEqual(workers.length, 1, "prewarming would load the model only to unload it");
	engine.dispose();
});

test("an idle teardown waits for a download in progress, then counts the idle time from ready", async () => {
	const {engine, workers} = makeEngine({behaviour: () => {}});
	engine.acquire().release();
	assert.strictEqual(engine.status().kind, "loading");

	await clock.advance(IDLE_MS);
	assert.strictEqual(workers[0].terminated, false, "a download is not cut short");

	workers[0].deliver({type: "ready", device: "wasm", dtype: "q4", loadMs: 1});
	await clock.flushMicrotasks();
	await clock.advance(IDLE_MS - 1);
	assert.strictEqual(workers[0].terminated, false);
	await clock.advance(1);
	assert.strictEqual(workers[0].terminated, true);
	engine.dispose();
});

test("progress is reported, and keeps a slow download from counting as stalled", async () => {
	const {engine, workers} = makeEngine({behaviour: () => {}});
	const statuses = [];
	engine.subscribe((status) => statuses.push(status));
	const lease = engine.acquire();

	for (let i = 1; i <= 5; i++) {
		await clock.advance(2 * 60_000);
		workers[0].deliver({type: "load-progress", file: "onnx/model_q4f16.onnx_data", loaded: i * 1_000_000, total: 10_000_000});
	}
	assert.strictEqual(engine.status().kind, "loading");
	assert.strictEqual(engine.status().progress, 50);
	assert.ok(statuses.some((status) => status.kind === "loading" && status.progress === 10));

	await clock.advance(3 * 60_000);
	assert.strictEqual(engine.status().kind, "error", "no progress for 3 minutes is a failed load");
	assert.strictEqual(workers[0].terminated, true);
	lease.release();
	engine.dispose();
});

test("a failed load shows the error; generating fails until a retry loads it", async () => {
	let failLoad = true;
	const {engine, workers} = makeEngine({
		behaviour: (message, worker) => {
			if (message.type === "init" && failLoad) {
				worker.deliver({type: "load-error", message: "Could not download the Test model.", offline: false});
				return;
			}
			workingModel(message, worker);
		},
	});

	await assert.rejects(engine.generate(REQUEST, {lane: "interactive"}), ModelNotReadyError);
	assert.deepStrictEqual(engine.status(), {kind: "error", message: "Could not download the Test model.", offline: false});

	// While something holds the model, more users don't hammer a failing download: retry() does.
	const lease = engine.acquire();
	await engine.whenSettled();
	assert.strictEqual(engine.status().kind, "error");
	failLoad = false;
	const second = engine.acquire();
	assert.strictEqual(engine.status().kind, "error");
	assert.strictEqual(workers.length, 2);

	engine.retry();
	await engine.whenSettled();
	assert.strictEqual(engine.status().kind, "ready");
	assert.strictEqual(workers.length, 3);
	lease.release();
	second.release();
	engine.dispose();
});

test("the first use after a failure tries loading again", async () => {
	let failLoad = true;
	const {engine, workers} = makeEngine({
		behaviour: (message, worker) => {
			if (message.type === "init" && failLoad) {
				worker.deliver({type: "load-error", message: "offline", offline: true});
				return;
			}
			workingModel(message, worker);
		},
	});
	await assert.rejects(engine.generate(REQUEST, {lane: "interactive"}), /offline/);
	failLoad = false;
	await engine.generate(REQUEST, {lane: "interactive"});
	assert.strictEqual(workers.length, 2);
	engine.dispose();
});

test("aborting a generation cancels it in the worker", async () => {
	const {engine, workers} = makeEngine({
		behaviour: (message, worker) => {
			if (message.type === "generate") return; // Still generating when the abort comes.
			workingModel(message, worker);
		},
	});
	const controller = new AbortController();

	const generation = engine.generate(REQUEST, {lane: "interactive", signal: controller.signal});
	await clock.flushMicrotasks();
	controller.abort();

	await assert.rejects(generation, GenerationCancelledError);
	assert.deepStrictEqual(workers[0].sent.map((message) => message.type), ["init", "generate", "cancel"]);
	engine.dispose();
});

test("an already aborted signal never reaches the worker", async () => {
	const {engine, workers} = makeEngine();
	const controller = new AbortController();
	controller.abort();
	await assert.rejects(engine.generate(REQUEST, {lane: "interactive", signal: controller.signal}), GenerationCancelledError);
	assert.ok(workers.every((worker) => !worker.sent.some((message) => message.type === "generate")));
	engine.dispose();
});

test("a crash fails what was waiting and leaves the error on show", async () => {
	const {engine, workers} = makeEngine({
		behaviour: (message, worker) => {
			if (message.type === "generate") return;
			workingModel(message, worker);
		},
	});
	const generation = engine.generate(REQUEST, {lane: "interactive"});
	await clock.flushMicrotasks();
	workers[0].crash("out of memory");

	await assert.rejects(generation, /crashed: out of memory/);
	assert.strictEqual(engine.status().kind, "error");
	assert.strictEqual(workers[0].terminated, true);
	engine.dispose();
});

test("disabling unloads the model and refuses work until enabled", async () => {
	const {engine, workers} = makeEngine();
	const lease = engine.acquire();
	await engine.whenSettled();

	engine.disable();
	assert.strictEqual(workers[0].terminated, true);
	assert.strictEqual(engine.status().kind, "disabled");
	await assert.rejects(engine.generate(REQUEST, {lane: "interactive"}), /turned off/);
	assert.strictEqual(workers.length, 1, "a disabled engine never starts a worker");

	engine.enable();
	await engine.whenSettled();
	assert.strictEqual(engine.status().kind, "ready", "a held lease loads the model again on enable");
	assert.strictEqual(workers.length, 2);
	lease.release();
	engine.dispose();
});

test("prewarming never starts a download", async () => {
	const notDownloaded = makeEngine({downloaded: false});
	await notDownloaded.engine.prewarm();
	assert.strictEqual(notDownloaded.workers.length, 0);

	const downloaded = makeEngine({downloaded: true});
	await downloaded.engine.prewarm();
	await downloaded.engine.whenSettled();
	assert.strictEqual(downloaded.workers.length, 1);
	assert.strictEqual(downloaded.engine.status().kind, "ready");
	notDownloaded.engine.dispose();
	downloaded.engine.dispose();
});

test("broken GPU output twice in a row is reported once", async () => {
	let reports = 0;
	const {engine} = makeEngine({
		behaviour: (message, worker) => workingModel(message, worker, {text: "���"}),
		onUnusableGpuOutput: () => reports++,
	});

	await engine.generate(REQUEST, {lane: "background"});
	assert.strictEqual(reports, 0);
	await engine.generate(REQUEST, {lane: "background"});
	assert.strictEqual(reports, 1);
	engine.dispose();
});

test("broken output on the CPU is not blamed on the GPU", async () => {
	let reports = 0;
	const {engine} = makeEngine({
		behaviour: (message, worker) => workingModel(message, worker, {text: "�", device: "wasm"}),
		onUnusableGpuOutput: () => reports++,
	});
	await engine.generate(REQUEST, {lane: "background"});
	await engine.generate(REQUEST, {lane: "background"});
	assert.strictEqual(reports, 0);
	engine.dispose();
});

test("a GPU that only produces invisible tokens counts as broken output", async () => {
	let reports = 0;
	const {engine} = makeEngine({
		behaviour: (message, worker) => {
			if (message.type === "init") return workingModel(message, worker);
			if (message.type === "generate") {
				worker.deliver({type: "result", requestId: message.requestId, text: "", stats: {...STATS, outputTokens: 72, stoppedBy: "max-tokens"}});
			}
		},
		onUnusableGpuOutput: () => reports++,
	});
	await engine.generate(REQUEST, {lane: "background"});
	await engine.generate(REQUEST, {lane: "background"});
	assert.strictEqual(reports, 1);
	engine.dispose();
});

test("download loads the model once and lets it go idle; unload stops a download midway", async () => {
	const {engine, workers} = makeEngine();
	await engine.download();
	assert.strictEqual(engine.status().kind, "ready");
	await clock.advance(IDLE_MS);
	assert.strictEqual(workers[0].terminated, true, "nothing keeps it loaded after the download");

	const slow = makeEngine({behaviour: () => {}});
	const download = slow.engine.download();
	await clock.flushMicrotasks();
	slow.engine.unload();
	await assert.rejects(download, /stopped/);
	assert.strictEqual(slow.workers[0].terminated, true);
	assert.strictEqual(slow.engine.status().kind, "unloaded");
	engine.dispose();
	slow.engine.dispose();
});
