import { TitlerSettings } from "../types";

export interface SettingsRepository {
	get(): TitlerSettings;

	updatePartial(patch: Partial<TitlerSettings>): Promise<void>;
}
