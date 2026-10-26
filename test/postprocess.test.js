const test = require("node:test");
const assert = require("node:assert");

const {cleanTitle, finalizeTitles, titleKey} = require("../dist/core/title/postprocess.js");

const FORMAT = {casing: "sentence", length: "medium", style: "topic"};

test("quotes, labels, emoji, hashtags and end punctuation are removed", () => {
	assert.strictEqual(cleanTitle("\"Sourdough starter care.\""), "Sourdough starter care");
	assert.strictEqual(cleanTitle("Title: Feeding schedule"), "Feeding schedule");
	assert.strictEqual(cleanTitle("**Starter care** 🍞"), "Starter care");
	assert.strictEqual(cleanTitle("#baking tips!"), "baking tips");
	assert.strictEqual(cleanTitle("«Le levain»"), "Le levain");
});

test("a colon that belongs to the title is kept until the file name step", () => {
	assert.strictEqual(cleanTitle("Python: decorators explained"), "Python: decorators explained");
});

test("titles are deduplicated ignoring case and accents, and the current name is excluded", () => {
	const titles = finalizeTitles(
		["Café notes", "cafe Notes", "Untitled", "Morning routine", "Evening routine", "Weekend plans"],
		{format: FORMAT, sourceText: "", exclude: ["Untitled"]},
	);
	assert.deepStrictEqual(titles, ["Café notes", "Morning routine", "Evening routine"]);
});

test("far over-long items are dropped rather than cut", () => {
	const long = "This is a sentence that rambles on for far too many words to ever be a title";
	assert.deepStrictEqual(finalizeTitles([long, "Short one"], {format: FORMAT, sourceText: "", exclude: []}), ["Short one"]);
});

test("the result is cased and safe as a file name", () => {
	const titles = finalizeTitles(["Sourdough Starter: Care Guide"], {format: FORMAT, sourceText: "", exclude: []});
	assert.deepStrictEqual(titles, ["Sourdough starter - care guide"]);
});

test("titleKey ignores case, accents and punctuation", () => {
	assert.strictEqual(titleKey("Café — Notes!"), titleKey("cafe notes"));
});

test("section headers returned as titles are dropped", () => {
	const titles = finalizeTitles(["Notes", "Short description", "Transcript noise types"], {format: FORMAT, sourceText: "", exclude: []});
	assert.deepStrictEqual(titles, ["Transcript noise types"]);
});
