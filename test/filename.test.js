const test = require("node:test");
const assert = require("node:assert");

const {resolveAvailableName, sanitizeFileName} = require("../dist/core/title/filename.js");

test("characters Obsidian refuses in file names are removed or replaced readably", () => {
	assert.strictEqual(sanitizeFileName("Python: decorators explained"), "Python - decorators explained");
	assert.strictEqual(sanitizeFileName("How often should I feed it?"), "How often should I feed it");
	assert.strictEqual(sanitizeFileName("Notes [draft] on a/b \"tests\" #1"), "Notes (draft) on ab tests 1");
	assert.strictEqual(sanitizeFileName("a*b<c>d|e^f\\g"), "abcdefg");
});

test("leading dots and trailing dots or spaces are trimmed", () => {
	assert.strictEqual(sanitizeFileName("..hidden title.. "), "hidden title");
	assert.strictEqual(sanitizeFileName(" - dashed"), "dashed");
});

test("reserved Windows names and empty results give an empty string", () => {
	assert.strictEqual(sanitizeFileName("CON"), "");
	assert.strictEqual(sanitizeFileName("???"), "");
});

test("long titles are cut at a word boundary", () => {
	const long = "word ".repeat(40).trim();
	const name = sanitizeFileName(long);
	assert.ok(name.length <= 100, `got ${name.length} characters`);
	assert.ok(!name.endsWith(" "));
	assert.ok(name.endsWith("word"));
});

test("a taken name gets the first free number, ignoring case", () => {
	assert.strictEqual(resolveAvailableName("Starter care", new Set()), "Starter care");
	assert.strictEqual(resolveAvailableName("Starter care", new Set(["starter care"])), "Starter care 1");
	assert.strictEqual(resolveAvailableName("Starter care", new Set(["starter care", "starter care 1"])), "Starter care 2");
});

test("the first suggestion free as both a file name and a link wins; otherwise the first, numbered", () => {
	const {chooseName} = require("../dist/core/title/filename.js");
	const nothingLinked = () => false;
	assert.strictEqual(chooseName(["Starter care", "Feeding"], new Set(), nothingLinked), "Starter care");
	assert.strictEqual(chooseName(["Starter care", "Feeding"], new Set(["starter care"]), nothingLinked), "Feeding");
	assert.strictEqual(chooseName(["Starter care", "Feeding"], new Set(), (name) => name === "Starter care"), "Feeding");
	assert.strictEqual(chooseName(["Starter care", "Feeding"], new Set(["starter care", "feeding"]), nothingLinked), "Starter care 1");
	assert.strictEqual(chooseName([], new Set(), nothingLinked), null);
});
