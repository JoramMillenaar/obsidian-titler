import { MarkdownView, Notice, Plugin } from "obsidian";
import { AppContainer } from "./appContainer";
import { initializePlugin } from "./app/initializePlugin";
import { registerTitleSuggest } from "./ui/registerTitleSuggest";
import { SettingsView } from "./ui/SettingsView";
import { registerTitlingEvents } from "./titling/events";
import { PickUndo } from "./ui/pickUndo";
import { registerModelIndicator } from "./ui/modelIndicator";

export default class Titler extends Plugin {
	private appContainer!: AppContainer;

	async onload(): Promise<void> {
		const container = new AppContainer(this);
		this.appContainer = container;

		const isFirstRun = Object.keys(await container.pluginDataStore.readRaw()).length === 0;
		const pluginData = await container.pluginDataStore.load();
		if (isFirstRun) await container.pluginDataStore.write(pluginData);

		this.addSettingTab(new SettingsView(this.app, this, container));

		const pickUndo = new PickUndo(this, {
			rename: (path, basename) => container.notes.rename(path, basename),
			takenNames: (path) => container.notes.takenNames(path),
			onUndone: (path) => container.titleEffects.reveal(path),
		});

		const titleSuggest = registerTitleSuggest(this, {
			suggestTitles: (request) => container.titleService.suggest({...request, lane: "interactive"}),
			recall: (file, words) => container.memory.recall(file.path, words, container.format()),
			remember: (file, titles, words) => container.memory.add(file.path, titles, words, container.format()),
			format: () => container.format(),
			engineStatus: () => container.engine.status(),
			subscribeEngine: (listener) => container.engine.subscribe(listener),
			isDownloaded: () => container.engine.isDownloaded(),
			downloadBytes: () => container.engine.config().downloadBytes[container.engine.config().dtype.webgpu] ?? 0,
			download: () => container.downloadModel(),
			retry: () => container.engine.retry(),
			takenNames: (file) => container.notes.takenNames(file.path),
			prewarm: () => void container.engine.prewarm(),
			onPicked: (file, from, to) => pickUndo.picked(file, from, to),
			// Back in a title, Mod+Z is its own undo again.
			onTitleFocus: () => pickUndo.forget(),
			onTitleBlur: (file) => container.autoTitler.titleBlurred(file.path),
		});

		this.addCommand({
			id: "suggest-titles",
			name: "Suggest titles for this note",
			checkCallback: (checking) => {
				const view = this.app.workspace.getActiveViewOfType(MarkdownView);
				if (!view?.file) return false;
				if (!checking && !titleSuggest.open(view)) new Notice("This note's title can't be edited here.");
				return true;
			},
		});

		this.addCommand({
			id: "name-note-now",
			name: "Name this note now",
			checkCallback: (checking) => {
				const file = this.app.workspace.getActiveViewOfType(MarkdownView)?.file;
				if (!file) return false;
				if (!checking) {
					if (container.engine.status().kind === "disabled") {
						new Notice("The AI is turned off on this device. You can turn it back on in the plugin's settings.");
						return true;
					}
					// Up while the AI thinks; a note too short to name is told so before it shows.
					const thinking = new Notice("Thinking of a name…", 0);
					void container.autoTitler.nameNow(file.path).then((result) => {
						thinking.hide();
						if (result.ok) return;
						new Notice(result.skip === "too-short"
							? "Write a few more words first: there's nothing to name this note by yet."
							: "Couldn't come up with a name for this note.");
					});
				}
				return true;
			},
		});

		registerModelIndicator(this, {
			status: () => container.engine.status(),
			subscribe: (listener) => container.engine.subscribe(listener),
			details: () => {
				const config = container.engine.config();
				const status = container.engine.status();
				const dtype = status.kind === "ready" ? status.dtype : config.dtype.webgpu;
				const unloadsAt = container.engine.unloadsAt();
				return {
					label: config.label,
					license: config.license,
					languages: config.languages,
					downloadBytes: config.downloadBytes[dtype] ?? config.downloadBytes[config.dtype.webgpu] ?? 0,
					unloadAfterSeconds: container.deviceSettingsRepo.get().unloadAfterSeconds,
					unloadsInMs: unloadsAt === null ? null : unloadsAt - Date.now(),
				};
			},
			unload: () => container.engine.unload(),
		});

		this.app.workspace.onLayoutReady(() => {
			registerTitlingEvents(this, {autoTitler: container.autoTitler, memory: container.memory, onOnline: () => container.engine.retry()});
			this.register(initializePlugin(container, isFirstRun));
		});
	}

	onunload(): void {
		this.appContainer.shutdown();
	}
}
