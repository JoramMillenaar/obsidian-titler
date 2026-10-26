const test = require("node:test");
const assert = require("node:assert");

const {makeUntitledMatcher, OBSIDIAN_UNTITLED_NAMES} = require("../dist/core/rules/untitled.js");

test("Obsidian's new-note names match, numbered or not, in any language and case", () => {
	const isUntitled = makeUntitledMatcher(OBSIDIAN_UNTITLED_NAMES);
	for (const name of ["Untitled", "Untitled 3", "untitled 12", "Naamloos", "Naamloos 2", "Unbenannt", "Sans titre 4", "未命名", "無題のファイル 2"]) {
		assert.ok(isUntitled(name), name);
	}
});

test("names that only start like it don't match", () => {
	const isUntitled = makeUntitledMatcher(OBSIDIAN_UNTITLED_NAMES);
	for (const name of ["Untitled ideas", "Untitled-2", "My untitled note", "Untitled 3b", "Naamloze vennootschap"]) {
		assert.ok(!isUntitled(name), name);
	}
});

test("custom names are matched literally, special characters included", () => {
	const isUntitled = makeUntitledMatcher(["New note (draft)", "a.b"]);
	assert.ok(isUntitled("New note (draft) 2"));
	assert.ok(isUntitled("a.b"));
	assert.ok(!isUntitled("aXb"), "a dot is not a wildcard");
	assert.ok(!makeUntitledMatcher([])("Untitled"));
});
