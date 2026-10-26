import { App, Notice, Plugin, PluginSettingTab, SettingDefinitionItem } from "obsidian";
import { AppContainer } from "../appContainer";
import { MAX_UNLOAD_AFTER_SECONDS, REPO_URL, TITLE_CASINGS, TITLE_LENGTHS, TITLE_STYLES } from "../constants";
import { TitleStyle, TitlerSettings } from "../types";
import { feedbackIssueUrl, FeedbackKind } from "../core/feedback";
import { formatBytes, settingsStatusText } from "../status/modelMessages";

/**
 * Keys the declarative controls read and write; the untitled names are a list stored as one line of
 * text, and the unload delay is a device setting.
 */
type ControlKey = "autoTitle" | "casing" | "length" | "minWords" | "extraUntitledNames" | "advancedOpen" | "unloadAfterSeconds";

const MIN_WORDS_FLOOR = 5;

function styleDescription(style: TitleStyle): string {
	return `For example: “${TITLE_STYLES[style].example}”.`;
}

export class SettingsView extends PluginSettingTab {
	constructor(app: App, plugin: Plugin, private readonly container: AppContainer) {
		super(app, plugin);
	}

	private isModelDisabled(): boolean {
		return this.container.engine.status().kind === "disabled";
	}

	getSettingDefinitions(): SettingDefinitionItem[] {
		const settings = this.container.settingsRepo.get();

		return [
			{
				name: "Name untitled notes automatically",
				desc: "When a note is still called “Untitled” and you've written a few sentences, it gets a title once you pause typing or switch notes. You can undo each one.",
				control: {type: "toggle", key: "autoTitle"},
			},
			{
				name: "Capitalization",
				control: {
					type: "dropdown",
					key: "casing",
					options: Object.fromEntries(TITLE_CASINGS.map((casing) => [casing.id, casing.label])),
				},
			},
			{
				name: "Length",
				control: {
					type: "dropdown",
					key: "length",
					options: Object.fromEntries(Object.entries(TITLE_LENGTHS).map(([id, length]) => [id, length.label])),
				},
			},
			{
				name: "Style",
				render: (setting) => {
					setting.setDesc(styleDescription(settings.style));
					setting.addDropdown((dropdown) => {
						for (const [id, style] of Object.entries(TITLE_STYLES)) dropdown.addOption(id, style.label);
						dropdown.setValue(this.container.settingsRepo.get().style);
						dropdown.onChange(async (value) => {
							setting.setDesc(styleDescription(value as TitleStyle));
							await this.container.settingsRepo.updatePartial({style: value as TitleStyle});
						});
					});
				},
			},
			{
				name: "AI model",
				render: (setting) => {
					const engine = this.container.engine;
					const size = engine.config().downloadBytes[engine.config().dtype.webgpu] ?? 0;
					let downloaded = false;
					let button: HTMLButtonElement | null = null;

					const paint = () => {
						const status = engine.status();
						setting.setDesc(`${engine.config().label}, running on this device. ${settingsStatusText(status, downloaded, size)}`);
						if (!button) return;
						const action = status.kind === "error" ? "Try again" : !downloaded && status.kind === "unloaded" ? "Download" : null;
						button.toggle(action !== null);
						if (action) button.setText(action);
					};
					setting.addButton((component) => {
						button = component.buttonEl;
						component.onClick(() => {
							if (engine.status().kind === "error") engine.retry();
							this.container.downloadModel();
						});
					});

					const refreshDownloaded = () => {
						void engine.isDownloaded().then((value) => {
							downloaded = value;
							paint();
						});
					};
					const unsubscribe = engine.subscribe((status) => {
						paint();
						if (status.kind !== "loading") refreshDownloaded();
					});
					return unsubscribe;
				},
			},
			{
				name: "Feedback",
				desc: "Found a bug or have an idea? This opens a GitHub issue in your browser, so you see exactly what is sent. It never includes your notes.",
				render: (setting) => {
					const open = (kind: FeedbackKind) => window.open(feedbackIssueUrl(REPO_URL, kind, this.container.collectEnvironment()));
					setting.addButton((button) => button.setButtonText("Report a bug").onClick(() => open("bug")));
					setting.addButton((button) => button.setButtonText("Suggest an idea").onClick(() => open("idea")));
				},
			},
			{
				name: "Show advanced settings",
				control: {type: "toggle", key: "advancedOpen"},
			},
			{
				type: "group",
				heading: "Advanced",
				// Kept open while the AI is off on this device, so the switch to turn it back on can't be missed.
				visible: () => this.container.settingsRepo.get().advancedOpen || this.isModelDisabled(),
				items: [
					{
						name: "Turn off the AI on this device",
						desc: "Unloads the model and stops all suggestions on this device only (this setting isn't synced). Use it if the AI slows this device down.",
						render: (setting) => {
							setting.addToggle((toggle) => {
								toggle.setValue(this.isModelDisabled());
								toggle.onChange((value) => {
									this.container.setModelDisabled(value);
									this.refreshDomState();
								});
							});
						},
					},
					{
						name: "Seconds before unloading the model",
						desc: "How long the model stays in memory on this device after it was last used (this setting isn't synced). Lower frees memory sooner; higher keeps the next suggestions quick. 0 unloads it as soon as it's done.",
						control: {
							type: "number",
							key: "unloadAfterSeconds",
							min: 0,
							max: MAX_UNLOAD_AFTER_SECONDS,
							validate: (value) => (value >= 0 && value <= MAX_UNLOAD_AFTER_SECONDS ? undefined : `Use 0 to ${MAX_UNLOAD_AFTER_SECONDS} seconds (a day).`),
						},
					},
					{
						name: "Words before naming automatically",
						desc: "How much you need to have written in an Untitled note before it gets a title.",
						control: {
							type: "number",
							key: "minWords",
							min: MIN_WORDS_FLOOR,
							validate: (value) => (value < MIN_WORDS_FLOOR ? `Use at least ${MIN_WORDS_FLOOR} words.` : undefined),
						},
					},
					{
						name: "Other names that count as untitled",
						desc: "Notes with these names are named automatically too, numbered or not. Separate names with commas. Obsidian's own “Untitled” always counts, in every language.",
						control: {type: "text", key: "extraUntitledNames", placeholder: "New note, Draft"},
					},
					{
						name: "Delete the downloaded model",
						desc: "Frees its disk space on this device. Titler downloads it again the next time it needs it.",
						render: (setting) => {
							setting.addButton((button) => {
								button.setButtonText("Delete").setDestructive().onClick(async () => {
									const size = formatBytes(this.container.engine.config().downloadBytes[this.container.engine.config().dtype.webgpu] ?? 0);
									const deleted = await this.container.deleteModel();
									new Notice(deleted ? `Deleted the AI model (${size}).` : "The AI model wasn't downloaded.");
									this.update();
								});
							});
						},
					},
				],
			},
		];
	}

	getControlValue(key: string): unknown {
		const settings = this.container.settingsRepo.get();
		if (key === "extraUntitledNames") return settings.extraUntitledNames.join(", ");
		if (key === "advancedOpen") return settings.advancedOpen || this.isModelDisabled();
		if (key === "unloadAfterSeconds") return this.container.deviceSettingsRepo.get().unloadAfterSeconds;
		return settings[key as Exclude<ControlKey, "extraUntitledNames" | "unloadAfterSeconds">];
	}

	async setControlValue(key: string, value: unknown): Promise<void> {
		if (key === "unloadAfterSeconds") {
			this.container.setUnloadAfterSeconds(Math.min(MAX_UNLOAD_AFTER_SECONDS, Math.max(0, Math.round(Number(value)))));
			return;
		}
		const patch: Partial<TitlerSettings> = key === "extraUntitledNames"
			? {extraUntitledNames: String(value).split(",").map((name) => name.trim()).filter(Boolean)}
			: {[key]: key === "minWords" ? Math.max(MIN_WORDS_FLOOR, Math.round(Number(value))) : value};
		await this.container.settingsRepo.updatePartial(patch);
		if (key === "advancedOpen") this.refreshDomState();
	}
}
