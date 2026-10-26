const test = require("node:test");
const assert = require("node:assert");

const {stripFencedCode, stripFrontmatter, toPlainText} = require("../dist/core/text/plainText.js");

test("frontmatter is removed", () => {
	assert.strictEqual(stripFrontmatter("---\ntags: [a]\n---\nBody"), "Body");
	assert.strictEqual(stripFrontmatter("No frontmatter\n---\n"), "No frontmatter\n---\n");
});

test("fenced code blocks are dropped, including longer closing fences only", () => {
	assert.strictEqual(stripFencedCode("a\n```js\ncode\n```\nb"), "a\nb");
	assert.strictEqual(stripFencedCode("a\n````\n```\nstill code\n````\nb"), "a\nb");
});

test("links keep their visible label; embeds and URLs go", () => {
	const text = toPlainText("See [[Folder/Bread notes|my bread notes]] and [[Starter#Feeding]]. ![[photo.png]] [docs](https://x.y) https://example.com");
	assert.strictEqual(text, "See my bread notes and Starter. docs");
});

test("block markup goes, the words stay", () => {
	const markdown = [
		"# Heading",
		"> [!note] Callout title",
		"> quoted",
		"- [ ] task item",
		"1. numbered",
		"**bold** and _italic_ and ==marked== and `code` #tag ^block-id",
		"---",
		"| a | b |",
		"|---|---|",
		"| 1 | 2 |",
	].join("\n");
	assert.strictEqual(toPlainText(markdown), [
		"Heading",
		"Callout title",
		"quoted",
		"task item",
		"numbered",
		"bold and italic and marked and code tag",
		"a · b",
		"1 · 2",
	].join("\n"));
});

test("comments, math and HTML are removed", () => {
	assert.strictEqual(toPlainText("a %%hidden%% b <!-- c --> d $$x^2$$ <b>e</b>"), "a b d e");
});

test("a first heading that repeats the note's name is dropped", () => {
	assert.strictEqual(toPlainText("# My note\nBody", {currentName: "my note"}), "Body");
	assert.strictEqual(toPlainText("# Other\nBody", {currentName: "my note"}), "Other\nBody");
});

test("snake_case words survive emphasis stripping", () => {
	assert.strictEqual(toPlainText("call my_function_name now"), "call my_function_name now");
});
