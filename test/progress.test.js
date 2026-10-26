const test = require("node:test");
const assert = require("node:assert");

const {DownloadProgress} = require("../dist/core/progress.js");

test("progress is measured over the expected total and never goes back when a second file starts", () => {
	const progress = new DownloadProgress(1000, 100);
	assert.strictEqual(progress.update({file: "a", loaded: 300, total: 600}), 30);
	assert.strictEqual(progress.update({file: "a", loaded: 600, total: 600}), 60);
	assert.strictEqual(progress.update({file: "b", loaded: 0, total: 400}), 60);
	assert.strictEqual(progress.update({file: "b", loaded: 400, total: 400}), 100);
});

test("small files don't count", () => {
	const progress = new DownloadProgress(1000, 100);
	assert.strictEqual(progress.update({file: "tokenizer.json", loaded: 10, total: 50}), null);
});

test("a total larger than expected is used instead", () => {
	const progress = new DownloadProgress(100, 10);
	assert.strictEqual(progress.update({file: "a", loaded: 100, total: 200}), 50);
});
