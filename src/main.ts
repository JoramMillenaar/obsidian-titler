import { MarkdownView, Notice, Plugin } from "obsidian";
import { AppContainer } from "./appContainer";
import { initializePlugin } from "./app/initializePlugin";
import { registerTitleSuggest } from "./ui/registerTitleSuggest";
import { SettingsView } from "./ui/SettingsView";
import { registerTitlingEvents } from "./titling/events";

export default class Titler extends Plugin {
	private appContainer!: AppContainer;

	async onload(): Promise<void> {
		const container = new AppContainer(this);
		this.appContainer = container;

		const isFirstRun = Object.keys(await container.pluginDataStore.readRaw()).length === 0;
		const pluginData = await container.pluginDataStore.load();
		if (isFirstRun) await container.pluginDataStore.write(pluginData);

		this.addSettingTab(new SettingsView(this.app, this, container));

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

		this.app.workspace.onLayoutReady(() => {
			registerTitlingEvents(this, {autoTitler: container.autoTitler, memory: container.memory, onOnline: () => container.engine.retry()});
			this.register(initializePlugin(container, isFirstRun));
		});
	}

	onunload(): void {
		this.appContainer.shutdown();
	}
}
