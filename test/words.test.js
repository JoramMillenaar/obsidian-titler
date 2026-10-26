const test = require("node:test");
const assert = require("node:assert");

const {countWords, words} = require("../dist/core/text/words.js");

test("words are counted across languages, apostrophes and hyphens kept inside a word", () => {
	assert.strictEqual(countWords("It's a well-known fact, 42 times over."), 7);
	assert.strictEqual(countWords("Één café, twee crèmes"), 4);
	assert.deepStrictEqual(words("don't stop"), ["don't", "stop"]);
});

test("each Chinese or Japanese character counts as a word", () => {
	assert.strictEqual(countWords("酸面团"), 3);
	assert.strictEqual(countWords("今日はいい天気"), 7);
});
