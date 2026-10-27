const test = require("node:test");
const assert = require("node:assert");

const {formatBytes, formatCountdown, formatDuration, modelMenu, pendingText, settingsStatusText, statusBarMessage} = require("../dist/status/modelMessages.js");

const GB = 1_383_000_000;

test("sizes read the way people say them", () => {
	assert.strictEqual(formatBytes(GB), "1.4 GB");
	assert.strictEqual(formatBytes(470_000_000), "470 MB");
});

test("a pending title says what the model is doing", () => {
	assert.strictEqual(pendingText({kind: "loading", progress: 42.7}, true), "Downloading the AI model… 42%");
	assert.strictEqual(pendingText({kind: "loading", progress: 42.7}, false), "Loading the AI model…");
	assert.strictEqual(pendingText({kind: "ready", device: "webgpu", dtype: "q4f16", loadMs: 1}, false), "Thinking…");
	assert.strictEqual(pendingText({kind: "disabled"}, false), null);
});

test("the status bar only speaks up for failures", () => {
	assert.strictEqual(statusBarMessage({kind: "loading", progress: 10}), null, "the status bar icon's ring shows loading");
	assert.match(statusBarMessage({kind: "error", message: "x", offline: true}).text, /offline/);
	assert.strictEqual(statusBarMessage({kind: "ready", device: "webgpu", dtype: "q4f16", loadMs: 1}), null);
});

test("settings describe the model's state, with its size when it matters", () => {
	assert.match(settingsStatusText({kind: "unloaded"}, false, GB), /Not downloaded yet \(1\.4 GB\)/);
	assert.match(settingsStatusText({kind: "unloaded"}, true, GB), /Downloaded \(1\.4 GB\)/);
	assert.match(settingsStatusText({kind: "loading", progress: 50}, false, GB), /Downloading… 50% of 1\.4 GB/);
	assert.match(settingsStatusText({kind: "ready", device: "wasm", dtype: "q4", loadMs: 1}, true, GB), /CPU/);
	assert.match(settingsStatusText({kind: "disabled"}, true, GB), /Turned off/);
});

const MODEL = {label: "Qwen3.5 2B", license: "Apache 2.0", languages: "201 languages", downloadBytes: GB, unloadAfterSeconds: 600, unloadsInMs: 452_300};
const READY = {kind: "ready", device: "webgpu", dtype: "q4f16", loadMs: 1234};

test("the status bar menu describes the loaded model, counts down to it unloading, and offers to unload it now", () => {
	assert.deepStrictEqual(modelMenu(READY, MODEL), {
		lines: ["Qwen3.5 2B · 1.4 GB", "On your GPU (q4f16), loaded in 1.2 s", "Unloads by itself in 7:33", "201 languages · Apache 2.0"],
		action: "Unload model",
	});
	assert.match(modelMenu({kind: "ready", device: "wasm", dtype: "q4", loadMs: 900}, MODEL).lines[1], /On your CPU \(q4\)/);
});

test("a model in use has no countdown yet: it says how long it stays after", () => {
	assert.strictEqual(modelMenu(READY, {...MODEL, unloadsInMs: null}).lines[2], "In use; unloads 10 minutes after");
	assert.strictEqual(modelMenu(READY, {...MODEL, unloadsInMs: null, unloadAfterSeconds: 0}).lines[2], "In use; unloads as soon as it's done");
});

test("countdowns show minutes and seconds, and hours past an hour", () => {
	assert.strictEqual(formatCountdown(452_300), "7:33");
	assert.strictEqual(formatCountdown(5_000), "0:05");
	assert.strictEqual(formatCountdown(3_725_000), "1:02:05");
	assert.strictEqual(formatCountdown(-200), "0:00");
});

test("while loading, the menu shows how far along it is and offers to stop", () => {
	assert.deepStrictEqual(modelMenu({kind: "loading", progress: 40.7}, MODEL), {lines: ["Qwen3.5 2B", "Loading… 40%"], action: "Stop loading"});
	assert.deepStrictEqual(modelMenu({kind: "loading", progress: null}, MODEL).lines, ["Qwen3.5 2B", "Loading…"]);
});

test("there's no menu (or icon) while the model isn't in memory", () => {
	for (const status of [{kind: "unloaded"}, {kind: "disabled"}, {kind: "error", message: "x", offline: false}]) {
		assert.strictEqual(modelMenu(status, MODEL), null, status.kind);
	}
});

test("durations read the way people say them", () => {
	assert.strictEqual(formatDuration(45), "45 seconds");
	assert.strictEqual(formatDuration(60), "1 minute");
	assert.strictEqual(formatDuration(600), "10 minutes");
	assert.strictEqual(formatDuration(5400), "1.5 hours");
	assert.strictEqual(formatDuration(86_400), "1 day");
});
