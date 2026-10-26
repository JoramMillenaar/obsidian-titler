const test = require("node:test");
const assert = require("node:assert");

const {looksUnusable} = require("../dist/core/title/sanity.js");

test("replacement characters, repeated tokens and list-less replies look broken", () => {
	assert.ok(looksUnusable("1. Sour�", 1));
	assert.ok(looksUnusable("the the the the the the the the the the the the the", 0));
	assert.ok(looksUnusable("ababababababababababababababab", 1));
	assert.ok(looksUnusable("I cannot help with that request because it is far too long for anything", 0));
});

test("a normal list is fine, and an empty reply is not broken output", () => {
	assert.ok(!looksUnusable("1. Starter care\n2. Feeding\n3. Bread", 3));
	assert.ok(!looksUnusable("", 0));
});

test("a reply of only special tokens (nothing visible after many tokens) is broken output", () => {
	assert.ok(looksUnusable("", 0, 72));
	assert.ok(!looksUnusable("", 0, 1), "one token can be a plain end of turn");
});
