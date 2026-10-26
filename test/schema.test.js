const test = require("node:test");
const assert = require("node:assert");

const {normalizeDeviceSettings, normalizePluginData, normalizeSettings} = require("../dist/core/rules/schema.js");
const {DEFAULT_DEVICE_SETTINGS, DEFAULT_SETTINGS, MAX_UNLOAD_AFTER_SECONDS} = require("../dist/constants.js");

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

test("device settings default to enabled on the GPU, unloading after 10 minutes", () => {
	assert.deepStrictEqual(normalizeDeviceSettings(null), {modelDisabled: false, forceWasm: false, unloadAfterSeconds: 600});
	assert.deepStrictEqual(normalizeDeviceSettings({forceWasm: true}), {modelDisabled: false, forceWasm: true, unloadAfterSeconds: 600});
});

test("the unload delay is kept in whole seconds, up to a day; broken values give the default", () => {
	assert.strictEqual(normalizeDeviceSettings({unloadAfterSeconds: 0}).unloadAfterSeconds, 0);
	assert.strictEqual(normalizeDeviceSettings({unloadAfterSeconds: 29.6}).unloadAfterSeconds, 30);
	assert.strictEqual(normalizeDeviceSettings({unloadAfterSeconds: 1e9}).unloadAfterSeconds, MAX_UNLOAD_AFTER_SECONDS);
	for (const broken of [-1, NaN, Infinity, "60", null]) {
		assert.strictEqual(normalizeDeviceSettings({unloadAfterSeconds: broken}).unloadAfterSeconds, DEFAULT_DEVICE_SETTINGS.unloadAfterSeconds);
	}
});
