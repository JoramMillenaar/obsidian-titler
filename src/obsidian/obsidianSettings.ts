import { TitlerSettings } from "../types";
import { SettingsRepository } from "../ports";
import { DEFAULT_SETTINGS } from "../constants";
import { ObsidianPluginDataStore } from "./obsidianPluginDataStore";

export class ObsidianSettingsRepository implements SettingsRepository {
	constructor(private readonly store: ObsidianPluginDataStore) {
	}

	get(): TitlerSettings {
		const cached = this.store.getCached();
		if (cached) return cached.settings;

		console.warn("[Titler] SettingsRepository.get() called before the plugin data store finished loading — using defaults.");
		return DEFAULT_SETTINGS;
	}

	async updatePartial(patch: Partial<TitlerSettings>): Promise<void> {
		await this.store.write({settings: {...this.get(), ...patch}});
	}
}
