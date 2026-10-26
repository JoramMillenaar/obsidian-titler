const test = require("node:test");
const assert = require("node:assert");

const {TitleService} = require("../dist/titling/titleService.js");
const {GenerationCancelledError} = require("../dist/generation/engine.js");

const FORMAT = {casing: "sentence", length: "medium", style: "topic"};
const NOTE = "Fed the sourdough starter twice today with rye flour. It doubled in five hours, so the next bake is on Saturday morning.";
const REPLY = "1. Sourdough starter feeding\n2. Rye starter rise time\n3. Saturday bake plan";

const tick = () => new Promise((resolve) => setImmediate(resolve));

/** An engine whose replies finish when the test says, streaming the reply in two pieces. */
function fakeEngine() {
	const calls = [];
	return {
		calls,
		config: () => ({id: "test-model"}),
		generate(request, options) {
			return new Promise((resolve, reject) => {
				const call = {
					request,
					options,
					stream(text) {
						options.onDelta?.(text);
					},
					finish(text = REPLY) {
						resolve({text, stats: {}});
					},
				};
				options.signal?.addEventListener("abort", () => reject(new GenerationCancelledError()), {once: true});
				calls.push(call);
			});
		},
	};
}

function service(engine, untitled = ["Untitled"]) {
	return new TitleService({engine, untitledNames: () => untitled});
}

test("titles stream in as the reply arrives, then resolve complete", async () => {
	const engine = fakeEngine();
	const updates = [];
	const result = service(engine).suggest({markdown: NOTE, currentName: "Untitled", format: FORMAT, lane: "interactive", onTitles: (titles) => updates.push(titles)});
	await tick();

	engine.calls[0].stream("1. Sourdough starter feeding\n2. Rye");
	assert.deepStrictEqual(updates, [["Sourdough starter feeding"]]);
	engine.calls[0].stream(" starter rise time\n3. Saturday bake plan");
	engine.calls[0].finish();

	assert.deepStrictEqual(await result, ["Sourdough starter feeding", "Rye starter rise time", "Saturday bake plan"]);
	assert.strictEqual(engine.calls[0].options.lane, "interactive");
});

test("a repeated request is answered from the cache", async () => {
	const engine = fakeEngine();
	const titles = service(engine);
	const first = titles.suggest({markdown: NOTE, currentName: "Untitled", format: FORMAT, lane: "interactive"});
	await tick();
	engine.calls[0].finish();
	await first;

	const again = await titles.suggest({markdown: NOTE, currentName: "Untitled", format: FORMAT, lane: "background"});
	assert.strictEqual(engine.calls.length, 1);
	assert.strictEqual(again.length, 3);

	const claim = titles.suggest({markdown: NOTE, currentName: "Untitled", format: {...FORMAT, style: "claim"}, lane: "interactive"});
	await tick();
	assert.strictEqual(engine.calls.length, 2, "another format asks the model again");
	engine.calls[1].finish();
	await claim;
});

test("the current name and untitled names are never suggested", async () => {
	const engine = fakeEngine();
	const result = service(engine).suggest({markdown: NOTE, currentName: "Rye starter rise time", format: FORMAT, lane: "interactive"});
	await tick();
	engine.calls[0].finish("1. Rye starter rise time\n2. Untitled\n3. Saturday bake plan");
	assert.deepStrictEqual(await result, ["Saturday bake plan"]);
});

test("overlapping identical requests share one generation, which stops only when both give up", async () => {
	const engine = fakeEngine();
	const titles = service(engine);
	const first = new AbortController();
	const second = new AbortController();

	const a = titles.suggest({markdown: NOTE, currentName: "Untitled", format: FORMAT, lane: "background", signal: first.signal});
	const b = titles.suggest({markdown: NOTE, currentName: "Untitled", format: FORMAT, lane: "interactive", signal: second.signal});
	await tick();
	assert.strictEqual(engine.calls.length, 1);

	first.abort();
	await assert.rejects(a, GenerationCancelledError);
	assert.strictEqual(engine.calls[0].options.signal.aborted, false, "still wanted by the second request");

	second.abort();
	await assert.rejects(b, GenerationCancelledError);
	assert.strictEqual(engine.calls[0].options.signal.aborted, true);
});

test("a request that joins late gets the titles streamed so far", async () => {
	const engine = fakeEngine();
	const titles = service(engine);
	const first = titles.suggest({markdown: NOTE, currentName: "Untitled", format: FORMAT, lane: "background"});
	await tick();
	engine.calls[0].stream("1. Sourdough starter feeding\n");

	const updates = [];
	const second = titles.suggest({markdown: NOTE, currentName: "Untitled", format: FORMAT, lane: "interactive", onTitles: (list) => updates.push(list)});
	assert.deepStrictEqual(updates, [["Sourdough starter feeding"]]);
	engine.calls[0].finish();
	await Promise.all([first, second]);
	assert.strictEqual(updates.at(-1).length, 3);
});
