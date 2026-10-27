const test = require("node:test");
const assert = require("node:assert");

const {MAX_REMEMBERED_TITLES, TitleMemory} = require("../dist/titling/titleMemory.js");

const FORMAT = {casing: "sentence", length: "medium", style: "topic"};

test("titles are recalled for their note, oldest first, without repeats", () => {
	const memory = new TitleMemory();
	memory.add("Untitled.md", ["Starter care", "Feeding schedule"], 40, FORMAT);
	memory.add("Untitled.md", ["starter  care", "Rye flour"], 45, FORMAT);
	assert.deepStrictEqual(memory.recall("Untitled.md", 50, FORMAT), ["Starter care", "Feeding schedule", "Rye flour"]);
	assert.deepStrictEqual(memory.recall("Other.md", 50, FORMAT), []);
});

test("a title is dropped once the note has more than doubled since it was thought up", () => {
	const memory = new TitleMemory();
	memory.add("Note.md", ["Early title"], 40, FORMAT);
	memory.add("Note.md", ["Later title"], 70, FORMAT);
	assert.deepStrictEqual(memory.recall("Note.md", 80, FORMAT), ["Early title", "Later title"]);
	assert.deepStrictEqual(memory.recall("Note.md", 81, FORMAT), ["Later title"]);
	assert.deepStrictEqual(memory.recall("Note.md", 60, FORMAT), ["Later title"], "gone for good");
	assert.deepStrictEqual(memory.recall("Note.md", 141, FORMAT), []);
});

test("titles in another format aren't offered", () => {
	const memory = new TitleMemory();
	memory.add("Note.md", ["Starter care"], 40, FORMAT);
	assert.deepStrictEqual(memory.recall("Note.md", 40, {...FORMAT, casing: "title"}), []);
});

test("titles follow their note when it's renamed, and go when it's deleted", () => {
	const memory = new TitleMemory();
	memory.add("Untitled.md", ["Starter care"], 40, FORMAT);
	memory.renamed("Untitled.md", "Starter care.md");
	assert.deepStrictEqual(memory.recall("Untitled.md", 40, FORMAT), []);
	assert.deepStrictEqual(memory.recall("Starter care.md", 40, FORMAT), ["Starter care"]);
	memory.deleted("Starter care.md");
	assert.deepStrictEqual(memory.recall("Starter care.md", 40, FORMAT), []);
});

test("a note keeps its most recent titles", () => {
	const memory = new TitleMemory();
	const titles = Array.from({length: MAX_REMEMBERED_TITLES + 3}, (_, i) => `Title number ${i}`);
	memory.add("Note.md", titles, 40, FORMAT);
	const recalled = memory.recall("Note.md", 40, FORMAT);
	assert.strictEqual(recalled.length, MAX_REMEMBERED_TITLES);
	assert.strictEqual(recalled.at(-1), titles.at(-1));
});
