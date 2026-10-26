const test = require("node:test");
const assert = require("node:assert");

const {normalizeDeviceSettings, normalizePluginData, normalizeSettings} = require("../dist/core/rules/schema.js");
const {DEFAULT_SETTINGS} = require("../dist/constants.js");

test("missing or broken data gives the defaults", () => {
	assert.deepStrictEqual(normalizePluginData(undefined), {settings: DEFAULT_SETTINGS});
	assert.deepStrictEqual(normalizeSettings({casing: "shouty", minWords: -3, modelId: "gpt-9", extraUntitledNames: "x"}), DEFAULT_SETTINGS);
});

test("valid values are kept", () => {
	const settings = normalizeSettings({casing: "title", length: "short", style: "claim", minWords: 12.4, autoTitle: false, extraUntitledNames: ["Draft", "", 3]});
	assert.strictEqual(settings.casing, "title");
	assert.strictEqual(settings.length, "short");
	assert.strictEqual(settings.style, "claim");
	assert.strictEqual(settings.minWords, 12);
	assert.strictEqual(settings.autoTitle, false);
	assert.deepStrictEqual(settings.extraUntitledNames, ["Draft"]);
});

test("device settings default to enabled on the GPU", () => {
	assert.deepStrictEqual(normalizeDeviceSettings(null), {modelDisabled: false, forceWasm: false});
	assert.deepStrictEqual(normalizeDeviceSettings({forceWasm: true}), {modelDisabled: false, forceWasm: true});
});
