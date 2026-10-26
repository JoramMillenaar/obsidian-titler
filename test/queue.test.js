const test = require("node:test");
const assert = require("node:assert");

const {CancelledError, LaneQueue} = require("../dist/generation/worker/queue.js");

function gated(log, name) {
	let release;
	const gate = new Promise((resolve) => (release = resolve));
	return {
		release,
		run: async () => {
			log.push(`start ${name}`);
			await gate;
			log.push(`end ${name}`);
			return name;
		},
	};
}

const tick = () => new Promise((resolve) => setImmediate(resolve));

test("one request runs at a time, interactive before background", async () => {
	const queue = new LaneQueue();
	const log = [];
	const first = gated(log, "first");
	const background = gated(log, "background");
	const interactive = gated(log, "interactive");

	const results = [
		queue.run(1, "background", first.run),
		queue.run(2, "background", background.run),
		queue.run(3, "interactive", interactive.run),
	];
	await tick();
	assert.deepStrictEqual(log, ["start first"]);

	first.release();
	await tick();
	assert.deepStrictEqual(log, ["start first", "end first", "start interactive"]);

	interactive.release();
	background.release();
	assert.deepStrictEqual(await Promise.all(results), ["first", "background", "interactive"]);
	assert.deepStrictEqual(log.slice(-3), ["end interactive", "start background", "end background"]);
});

test("a waiting request can be cancelled; a running one can't be from here", async () => {
	const queue = new LaneQueue();
	const log = [];
	const running = gated(log, "running");
	const waiting = gated(log, "waiting");

	const runningResult = queue.run(1, "interactive", running.run);
	const waitingResult = queue.run(2, "interactive", waiting.run);
	await tick();

	assert.strictEqual(queue.isRunning(1), true);
	assert.strictEqual(queue.cancel(1), false);
	assert.strictEqual(queue.cancel(2), true);
	await assert.rejects(waitingResult, CancelledError);

	running.release();
	assert.strictEqual(await runningResult, "running");
	assert.ok(!log.includes("start waiting"));
});

test("close rejects waiting requests and waits for the running one", async () => {
	const queue = new LaneQueue();
	const log = [];
	const running = gated(log, "running");
	const runningResult = queue.run(1, "background", running.run);
	const waitingResult = queue.run(2, "background", async () => "never");
	await tick();

	const closed = queue.close();
	await assert.rejects(waitingResult, /shutting down/);
	running.release();
	await closed;
	assert.strictEqual(await runningResult, "running");
	await assert.rejects(queue.run(3, "interactive", async () => "late"), /shutting down/);
});
