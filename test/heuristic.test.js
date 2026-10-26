const test = require("node:test");
const assert = require("node:assert");

const {heuristicTitle} = require("../dist/core/title/heuristic.js");

test("the first heading wins, markup removed", () => {
	assert.deepStrictEqual(heuristicTitle("---\na: 1\n---\nIntro line\n## The **real** heading\n"), {title: "The real heading", source: "heading"});
});

test("without a heading, the first sentence of the first line is used when short", () => {
	assert.deepStrictEqual(heuristicTitle("Meeting with the bakery team. We talked about prices."), {title: "Meeting with the bakery team", source: "line"});
});

test("a long first sentence gives no suggestion", () => {
	assert.strictEqual(heuristicTitle("Today I went to the market and bought flour, salt, yeast, butter and some other things."), null);
	assert.strictEqual(heuristicTitle(""), null);
});

test("headings inside code blocks don't count", () => {
	assert.deepStrictEqual(heuristicTitle("```\n# not a heading\n```\nShort line"), {title: "Short line", source: "line"});
});
