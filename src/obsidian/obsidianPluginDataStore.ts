import { Plugin } from "obsidian";
import { TitlerPluginData } from "../types";
import { PluginDataStore } from "../ports";
import { normalizePluginData } from "../core/rules/schema";

export class ObsidianPluginDataStore implements PluginDataStore {
	private cache: TitlerPluginData | null = null;

	constructor(private readonly plugin: Plugin) {
	}

	async load(): Promise<TitlerPluginData> {
		this.cache = normalizePluginData(await this.readRaw());
		return this.cache;
	}

	getCached(): TitlerPluginData | null {
		return this.cache;
	}

	async readRaw(): Promise<Record<string, unknown>> {
		return (await this.plugin.loadData() as Record<string, unknown> | null) ?? {};
	}

	async write(data: TitlerPluginData): Promise<void> {
		this.cache = data;
		await this.plugin.saveData(data);
	}
}
