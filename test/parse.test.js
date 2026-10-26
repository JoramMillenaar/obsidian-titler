const test = require("node:test");
const assert = require("node:assert");

const {createListStream, parseList, parseListLine, stripThinking} = require("../dist/core/title/parse.js");

test("numbered, bracketed and bulleted lines each give their item", () => {
	assert.deepStrictEqual(parseListLine("1. Sourdough starter care"), ["Sourdough starter care"]);
	assert.deepStrictEqual(parseListLine("2) Feeding schedule"), ["Feeding schedule"]);
	assert.deepStrictEqual(parseListLine("**3.** Bold marker"), ["Bold marker"]);
	assert.deepStrictEqual(parseListLine("- Dashed"), ["Dashed"]);
	assert.deepStrictEqual(parseListLine("• Bullet"), ["Bullet"]);
});

test("preambles, remarks and blank lines are not items", () => {
	assert.deepStrictEqual(parseListLine("Here are three titles for your note:"), []);
	assert.deepStrictEqual(parseListLine("   "), []);
	assert.deepStrictEqual(
		parseListLine("I hope these titles capture the main ideas of the note well and help you find it again later on."),
		[],
	);
});

test("an inline list on one line is split into its items", () => {
	assert.deepStrictEqual(parseListLine("1. Alpha beta 2. Gamma 3. Delta epsilon"), ["Alpha beta", "Gamma", "Delta epsilon"]);
});

test("a plain short line counts as an item", () => {
	assert.deepStrictEqual(parseList("Starter care\nFeeding times\n"), ["Starter care", "Feeding times"]);
});

test("items complete only when their line ends, so a stream never yields half a title", () => {
	const stream = createListStream();
	assert.deepStrictEqual(stream.push("1. Sour"), []);
	assert.deepStrictEqual(stream.push("dough care\n2. Feed"), ["Sourdough care"]);
	assert.deepStrictEqual(stream.push("ing\n"), ["Feeding"]);
	assert.deepStrictEqual(stream.push("3. Last one"), []);
	assert.deepStrictEqual(stream.finish(), ["Last one"]);
	assert.strictEqual(stream.count, 3);
});

test("reasoning blocks are ignored, even when they arrive in pieces", () => {
	const stream = createListStream();
	assert.deepStrictEqual(stream.push("<think>\n1. Not a"), []);
	assert.deepStrictEqual(stream.push(" title\n</think>\n1. Real title\n"), ["Real title"]);
	assert.strictEqual(stripThinking("a<think>b</think>c<think>open"), "ac");
});

test("numbering without punctuation is read when it matches the item's position", () => {
	assert.deepStrictEqual(parseList("1 Helm package manager\n2 Using helm charts\n3 Debugging templates"), [
		"Helm package manager",
		"Using helm charts",
		"Debugging templates",
	]);
	assert.deepStrictEqual(parseList("3 ways to feed a starter\n"), ["3 ways to feed a starter"]);
});

test("once a reply uses markers, an unmarked header line is not an item, and doesn't count toward stopping", () => {
	const stream = createListStream();
	stream.push("Notes\n1. Analyze transcript types\n2. Identify noise sources\n");
	assert.strictEqual(stream.count, 2, "the worker keeps going until a third real item");
	stream.push("3. Dialog structure\nHope these help!");
	stream.finish();
	assert.deepStrictEqual(stream.items(), ["Analyze transcript types", "Identify noise sources", "Dialog structure"]);
});
