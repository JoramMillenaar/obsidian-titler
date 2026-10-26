const test = require("node:test");
const assert = require("node:assert");

const {buildTitleMessages, maxNewTokens, NOTE_MARKER, systemPrompt} = require("../dist/core/title/prompt.js");

test("the prompt asks for the configured count, style, length and casing", () => {
	const prompt = systemPrompt({casing: "title", length: "short", style: "question"});
	assert.match(prompt, /exactly 3 different titles/);
	assert.match(prompt, /question the note answers/);
	assert.match(prompt, /2 to 4 words/);
	assert.match(prompt, /Title Case/);
	assert.match(prompt, /same language as the note/);
});

test("a language hint names the language", () => {
	assert.match(systemPrompt({casing: "sentence", length: "long", style: "topic"}, {languageHint: "Dutch"}), /in Dutch/);
});

test("the note goes in the user message at the marker", () => {
	const messages = buildTitleMessages({casing: "sentence", length: "medium", style: "claim"});
	assert.deepStrictEqual(messages.map((message) => message.role), ["system", "user"]);
	assert.ok(messages[1].content.includes(NOTE_MARKER));
});

test("longer titles get a bigger output budget", () => {
	const budget = (length) => maxNewTokens({casing: "sentence", length, style: "topic"});
	assert.ok(budget("short") < budget("medium") && budget("medium") < budget("long"));
});

test("the prompt holds no example title a model could copy", () => {
	for (const style of ["topic", "claim", "question"]) {
		assert.doesNotMatch(systemPrompt({casing: "sentence", length: "medium", style}), /for example|e\.g\.|sourdough/i);
	}
});

test("a title request names the note's language when it can be told", () => {
	const {buildTitleRequest} = require("../dist/core/title/request.js");
	const format = {casing: "sentence", length: "medium", style: "topic"};
	const dutch = buildTitleRequest(format, "Vandaag gebeld met het energiebedrijf over de eindafrekening. Er staat nog een bedrag open, maar dat klopt niet.");
	assert.match(dutch.messages[0].content, /in Dutch/);
	assert.strictEqual(dutch.params.stopAfterItems, 3);
	const unknown = buildTitleRequest(format, "Kubernetes Helm charts");
	assert.match(unknown.messages[0].content, /same language as the note/);
});

test("the note's opening decides its language", () => {
	const {buildTitleRequest} = require("../dist/core/title/request.js");
	const format = {casing: "sentence", length: "medium", style: "topic"};
	const english = "Jan asked me to sponsor him and I want to think about what that means for the both of us. ".repeat(25);
	const dutch = "Hij vraagt of ik hem wil steunen en dat is een grote stap voor ons, maar ik wil er goed over nadenken. ".repeat(60);
	assert.match(buildTitleRequest(format, english + dutch).messages[0].content, /in English/);
});
