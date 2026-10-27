import { apiVersion, Platform, Plugin, TFile } from "obsidian";
import { ObsidianStatusBar } from "./obsidian/obsidianStatusBar";
import { ObsidianPluginDataStore } from "./obsidian/obsidianPluginDataStore";
import { ObsidianSettingsRepository } from "./obsidian/obsidianSettings";
import { ObsidianDeviceSettingsRepository } from "./obsidian/obsidianDeviceSettings";
import { ObsidianNotes } from "./obsidian/obsidianNotes";
import { excludedFolders, isInFolders } from "./obsidian/excludedFolders";
import { isTitleFocused } from "./obsidian/titleElements";
import { untitledNames } from "./obsidian/untitledNames";
import { DeviceSettingsRepository, SettingsRepository, StatusReporter } from "./ports";
import { AUTO_TITLE_PAUSE_MS, GENERATION_MODELS, MODEL_CACHE_KEY } from "./constants";
import { TitleFormat } from "./types";
import { GenerationEngine } from "./generation/engine";
import { deleteModelDownload, isModelDownloaded } from "./generation/modelCache";
import { modelWorkerScript, startWorker } from "./workerScript";
import { TitleService } from "./titling/titleService";
import { AutoTitler } from "./titling/autoTitler";
import { TitleMemory } from "./titling/titleMemory";
import { makeUntitledMatcher } from "./core/rules/untitled";
import { countWords } from "./core/text/words";
import { toPlainText } from "./core/text/plainText";
import { Environment } from "./core/feedback";
import { showRenamedNotice } from "./ui/autoTitleNotice";
import { showDownloadNotice } from "./ui/downloadNotice";
import { TitleEffects } from "./ui/titleEffects";

export class AppContainer {
	readonly status: StatusReporter;
	readonly pluginDataStore: ObsidianPluginDataStore;
	readonly settingsRepo: SettingsRepository;
	readonly deviceSettingsRepo: DeviceSettingsRepository;
	readonly notes: ObsidianNotes;
	readonly engine: GenerationEngine;
	readonly titleService: TitleService;
	readonly memory = new TitleMemory();
	readonly autoTitler: AutoTitler;
	readonly titleEffects: TitleEffects;

	private untitledMatcher: ((basename: string) => boolean) | null = null;

	constructor(private readonly plugin: Plugin) {
		this.status = new ObsidianStatusBar(plugin);
		this.pluginDataStore = new ObsidianPluginDataStore(plugin);
		this.settingsRepo = new ObsidianSettingsRepository(this.pluginDataStore);
		this.deviceSettingsRepo = new ObsidianDeviceSettingsRepository(plugin);
		this.notes = new ObsidianNotes(plugin.app);

		this.engine = new GenerationEngine({
			getConfig: () => GENERATION_MODELS[this.settingsRepo.get().modelId],
			startWorker: () => startWorker(modelWorkerScript()),
			allowWebGpu: !Platform.isMobile,
			isForceWasm: () => this.deviceSettingsRepo.get().forceWasm,
			isDownloaded: (config) => isModelDownloaded(config, MODEL_CACHE_KEY),
			cacheKey: MODEL_CACHE_KEY,
			idleMs: () => this.deviceSettingsRepo.get().unloadAfterSeconds * 1000,
			onUnusableGpuOutput: () => {
				// Some GPUs overflow in fp16 and produce garbage: the CPU is slower but reliable.
				this.deviceSettingsRepo.updatePartial({forceWasm: true});
				this.status.update("The GPU gave unusable results; switched to the CPU.", 8000);
				this.engine.reload();
			},
		});

		this.titleService = new TitleService({
			engine: this.engine,
			untitledNames,
		});

		this.titleEffects = new TitleEffects(plugin);

		this.autoTitler = new AutoTitler({
			notes: this.notes,
			suggest: (request) => this.titleService.suggest({...request, lane: "background"}),
			settings: () => {
				const settings = this.settingsRepo.get();
				return {autoTitle: settings.autoTitle, minWords: settings.minWords, format: this.format()};
			},
			isModelAvailable: async () => this.engine.status().kind !== "disabled" && await this.engine.isDownloaded(),
			isUntitled: (basename) => this.isUntitled(basename),
			isExcludedPath: (path) => isInFolders(path, excludedFolders(plugin.app)),
			isTitleFocused: (path) => {
				const file = plugin.app.vault.getAbstractFileByPath(path);
				return file instanceof TFile && isTitleFocused(plugin.app, file);
			},
			countWords: (markdown) => countWords(toPlainText(markdown)),
			notifyRenamed: (_from, to, undo) => {
				this.titleEffects.reveal(to);
				showRenamedNotice(to.split("/").pop()?.replace(/\.md$/, "") ?? to, undo);
			},
			onNaming: (path, naming) => this.titleEffects.setNaming(path, naming),
			remember: (path, titles, words, format) => this.memory.add(path, titles, words, format),
			pauseMs: AUTO_TITLE_PAUSE_MS,
		});
	}

	format(): TitleFormat {
		const {casing, length, style} = this.settingsRepo.get();
		return {casing, length, style};
	}

	isUntitled(basename: string): boolean {
		// Built on first use: Obsidian's language, which leads the list, only changes with a restart.
		this.untitledMatcher ??= makeUntitledMatcher(untitledNames());
		return this.untitledMatcher(basename);
	}

	/** Downloads the model, with a notice that shows progress and can put it off. */
	downloadModel(): void {
		showDownloadNotice(this.engine);
		this.engine.download().catch((error: unknown) => {
			console.warn("[Titler] The model download didn't finish:", error);
		});
	}

	/** Turns the AI off (or back on) on this device only. */
	setModelDisabled(disabled: boolean): void {
		this.deviceSettingsRepo.updatePartial({modelDisabled: disabled});
		if (disabled) this.engine.disable();
		else this.engine.enable();
	}

	/** Sets how long the model stays loaded after use, on this device only. A model loaded now counts down from here. */
	setUnloadAfterSeconds(seconds: number): void {
		this.deviceSettingsRepo.updatePartial({unloadAfterSeconds: seconds});
		this.engine.idleTimeChanged();
	}

	/** Frees the model's disk space on this device; the next use downloads it again. */
	async deleteModel(): Promise<number> {
		this.engine.unload();
		return deleteModelDownload(this.engine.config(), MODEL_CACHE_KEY);
	}

	collectEnvironment(): Environment {
		const status = this.engine.status();
		const {casing, length, style, autoTitle, minWords} = this.settingsRepo.get();
		return {
			pluginVersion: this.plugin.manifest.version,
			obsidianVersion: apiVersion,
			platform: [Platform.isMacOS ? "macOS" : Platform.isWin ? "Windows" : Platform.isLinux ? "Linux" : "other", Platform.isMobile ? "mobile" : "desktop"].join(" "),
			model: this.engine.config().label,
			engine: status.kind === "ready" ? `ready on ${status.device} (${status.dtype})` : status.kind === "error" ? `error: ${status.message}` : status.kind,
			settings: `auto-title ${autoTitle ? "on" : "off"}, ${minWords} words, ${casing}, ${length}, ${style}`,
		};
	}

	shutdown(): void {
		this.autoTitler.dispose();
		this.titleEffects.dispose();
		this.engine.dispose();
		this.status.clear();
	}
}
