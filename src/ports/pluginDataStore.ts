import { TitlerPluginData } from "../types";

export interface PluginDataStore {
	write(data: TitlerPluginData): Promise<void>;

	readRaw(): Promise<Record<string, unknown>>;
}
