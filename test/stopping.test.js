const test = require("node:test");
const assert = require("node:assert");

const {createListStream} = require("../dist/core/title/parse.js");
const {hasEnoughItems} = require("../dist/core/title/stopping.js");

const FORMAT = {casing: "sentence", length: "medium", style: "topic"};
const NOTE = "Fed the sourdough starter twice today with rye flour. It doubled in five hours.";

/** Streams `reply` line by line, returning the line after which the reply would stop (or null). */
function stopsAfter(reply, params) {
	const list = createListStream();
	const lines = reply.split("\n");
	for (const [index, line] of lines.entries()) {
		if (list.push(`${line}\n`).length && hasEnoughItems(list, params, NOTE)) return index + 1;
	}
	return null;
}

test("without a title count, three list items are enough", () => {
	assert.strictEqual(stopsAfter("1. A\n2. B\n3. C\n4. D", {maxNewTokens: 99, stopAfterItems: 3}), 3);
});

test("titles that will be filtered out don't count toward stopping", () => {
	const params = {maxNewTokens: 99, stopAfterItems: 3, countTitles: {format: FORMAT, exclude: ["Starter feeding", "Rye flour ratios"]}};
	const reply = ["1. Starter feeding", "2. rye flour ratios", "3. Notes", "4. Doubling in five hours", "5. Twice-daily feeding", "6. Saturday bake plan", "7. One too many"].join("\n");
	assert.strictEqual(stopsAfter(reply, params), 6, "a repeat, a repeat in other casing and a generic title don't count");
});

test("a reply that never has enough new titles runs to its end", () => {
	const params = {maxNewTokens: 99, stopAfterItems: 3, countTitles: {format: FORMAT, exclude: ["Starter feeding"]}};
	assert.strictEqual(stopsAfter("1. Starter feeding\n2. Starter feeding\n3. Rye", params), null);
});
