const test = require("node:test");
const assert = require("node:assert");

const {formatBytes, pendingText, settingsStatusText, statusBarMessage} = require("../dist/status/modelMessages.js");

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

test("the status bar only speaks up for downloads and failures", () => {
	assert.deepStrictEqual(statusBarMessage({kind: "loading", progress: 10}, true), {text: "Downloading AI model… 10%", timeout: null});
	assert.strictEqual(statusBarMessage({kind: "loading", progress: 10}, false), null, "loading from disk is quick and quiet");
	assert.match(statusBarMessage({kind: "error", message: "x", offline: true}, false).text, /offline/);
	assert.strictEqual(statusBarMessage({kind: "ready", device: "webgpu", dtype: "q4f16", loadMs: 1}, false), null);
});

test("settings describe the model's state, with its size when it matters", () => {
	assert.match(settingsStatusText({kind: "unloaded"}, false, GB), /Not downloaded yet \(1\.4 GB\)/);
	assert.match(settingsStatusText({kind: "unloaded"}, true, GB), /Downloaded \(1\.4 GB\)/);
	assert.match(settingsStatusText({kind: "loading", progress: 50}, false, GB), /Downloading… 50% of 1\.4 GB/);
	assert.match(settingsStatusText({kind: "ready", device: "wasm", dtype: "q4", loadMs: 1}, true, GB), /CPU/);
	assert.match(settingsStatusText({kind: "disabled"}, true, GB), /Turned off/);
});
