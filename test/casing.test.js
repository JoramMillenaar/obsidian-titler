const test = require("node:test");
const assert = require("node:assert");

const {applyCasing} = require("../dist/core/title/casing.js");

test("sentence case capitalizes the first word and keeps acronyms and brands", () => {
	assert.strictEqual(applyCasing("using AI on my iPhone", "sentence"), "Using AI on my iPhone");
	assert.strictEqual(applyCasing("macOS tips", "sentence"), "macOS tips");
});

test("sentence case lowers a Title-Cased reply when the note doesn't capitalize those words", () => {
	const note = "Feeding the starter twice a day keeps it active. Starter care matters.";
	assert.strictEqual(applyCasing("Sourdough Starter Care Routine", "sentence", note), "Sourdough starter care routine");
});

test("sentence case keeps words the note itself capitalizes, like names and German nouns", () => {
	const note = "Heute habe ich mit Anna über den Sauerteig gesprochen. Der Sauerteig braucht Pflege.";
	assert.strictEqual(applyCasing("Gespräch mit Anna über Sauerteig", "sentence", note), "Gespräch mit Anna über Sauerteig");
});

test("Title Case capitalizes words except small English ones in the middle", () => {
	assert.strictEqual(applyCasing("the art of feeding a starter", "title"), "The Art of Feeding a Starter");
	assert.strictEqual(applyCasing("what to think about", "title"), "What to Think About");
	assert.strictEqual(applyCasing("notes on GPT models", "title"), "Notes on GPT Models");
});

test("lowercase lowers everything", () => {
	assert.strictEqual(applyCasing("Sourdough Starter AI", "lower"), "sourdough starter ai");
});

test("text without case is left alone", () => {
	assert.strictEqual(applyCasing("酸面团的喂养", "sentence"), "酸面团的喂养");
	assert.strictEqual(applyCasing("酸面团的喂养", "title"), "酸面团的喂养");
});

test("capitals in headings and labels don't count as the note's own casing", () => {
	const note = "Technical Competence\nProblem Solving\nCompanies look for people who can reason about a problem and explain their competence clearly.";
	assert.strictEqual(applyCasing("Technical Competence and Problem Solving", "sentence", note), "Technical competence and problem solving");
});

test("a capitalized word the note doesn't use is kept only when the note's language capitalizes nouns", () => {
	const english = "We talked about the bakery and how the prices went up again this month.";
	assert.strictEqual(applyCasing("Bakery Price Increase", "sentence", english), "Bakery price increase");
	const german = "Wir haben über die Bäckerei gesprochen. Die Preise sind diesen Monat wieder gestiegen, sagt der Bäcker.";
	assert.strictEqual(applyCasing("Gespräch über Preiserhöhung", "sentence", german), "Gespräch über Preiserhöhung");
});

test("a name keeps its capital in the possessive", () => {
	const note = "There is a saying by Kurt Vonnegut about this, and I keep coming back to it.";
	assert.strictEqual(applyCasing("Kurt Vonnegut's Reflection on Ego", "sentence", note), "Kurt Vonnegut's reflection on ego");
});
