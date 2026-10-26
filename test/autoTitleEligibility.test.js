const test = require("node:test");
const assert = require("node:assert");

const {decideAutoTitle} = require("../dist/core/rules/autoTitleEligibility.js");

const READY = {
	enabled: true,
	extension: "md",
	isUntitled: true,
	inExcludedFolder: false,
	frontmatterKeys: [],
	wordsTyped: 40,
	minWords: 30,
	optedOut: false,
	titleFocused: false,
};

test("an Untitled note with enough typed words is named", () => {
	assert.deepStrictEqual(decideAutoTitle(READY), {ok: true});
});

test("each reason to leave a note alone", () => {
	const cases = [
		[{enabled: false}, "off"],
		[{extension: "canvas"}, "not-markdown"],
		[{isUntitled: false}, "named"],
		[{inExcludedFolder: true}, "excluded-folder"],
		[{frontmatterKeys: ["tags", "excalidraw-plugin"]}, "special-note"],
		[{frontmatterKeys: ["kanban-plugin"]}, "special-note"],
		[{optedOut: true}, "opted-out"],
		[{wordsTyped: 29}, "too-short"],
		[{titleFocused: true}, "editing-title"],
	];
	for (const [change, reason] of cases) {
		assert.deepStrictEqual(decideAutoTitle({...READY, ...change}), {ok: false, skip: reason}, reason);
	}
});
