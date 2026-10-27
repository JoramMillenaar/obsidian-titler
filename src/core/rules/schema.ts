import { DeviceSettings, TitlerPluginData, TitlerSettings } from "../../types";
import {
	DEFAULT_DEVICE_SETTINGS,
	DEFAULT_SETTINGS,
	GENERATION_MODELS,
	MAX_UNLOAD_AFTER_SECONDS,
	TITLE_CASINGS,
	TITLE_LENGTHS,
	TITLE_STYLES,
} from "../../constants";

function oneOf<T extends string>(value: unknown, allowed: readonly string[], fallback: T): T {
	return typeof value === "string" && allowed.includes(value) ? value as T : fallback;
}

export function normalizeSettings(
	value: Partial<TitlerSettings> | undefined,
): TitlerSettings {
	const minWords = value?.minWords;

	return {
		autoTitle: typeof value?.autoTitle === "boolean"
			? value.autoTitle
			: DEFAULT_SETTINGS.autoTitle,
		casing: oneOf(value?.casing, TITLE_CASINGS.map((casing) => casing.id), DEFAULT_SETTINGS.casing),
		length: oneOf(value?.length, Object.keys(TITLE_LENGTHS), DEFAULT_SETTINGS.length),
		style: oneOf(value?.style, Object.keys(TITLE_STYLES), DEFAULT_SETTINGS.style),
		minWords: typeof minWords === "number" && Number.isFinite(minWords) && minWords >= 1
			? Math.round(minWords)
			: DEFAULT_SETTINGS.minWords,
		advancedOpen: typeof value?.advancedOpen === "boolean"
			? value.advancedOpen
			: DEFAULT_SETTINGS.advancedOpen,
		modelId: oneOf(value?.modelId, Object.keys(GENERATION_MODELS), DEFAULT_SETTINGS.modelId),
	};
}

export function normalizePluginData(
	value: Partial<TitlerPluginData> | undefined,
): TitlerPluginData {
	return {settings: normalizeSettings(value?.settings)};
}

export function normalizeDeviceSettings(
	value: Partial<DeviceSettings> | null | undefined,
): DeviceSettings {
	const unloadAfterSeconds = value?.unloadAfterSeconds;

	return {
		modelDisabled: typeof value?.modelDisabled === "boolean"
			? value.modelDisabled
			: DEFAULT_DEVICE_SETTINGS.modelDisabled,
		forceWasm: typeof value?.forceWasm === "boolean"
			? value.forceWasm
			: DEFAULT_DEVICE_SETTINGS.forceWasm,
		unloadAfterSeconds: typeof unloadAfterSeconds === "number" && Number.isFinite(unloadAfterSeconds) && unloadAfterSeconds >= 0
			? Math.min(MAX_UNLOAD_AFTER_SECONDS, Math.round(unloadAfterSeconds))
			: DEFAULT_DEVICE_SETTINGS.unloadAfterSeconds,
	};
}
