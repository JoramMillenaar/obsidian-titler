import { App, normalizePath } from "obsidian";

/**
 * Folders whose notes keep their names: templates (core Templates and Templater) and daily notes.
 * Read from those plugins' private settings, so each lookup may fail on its own.
 */
export function excludedFolders(app: App): string[] {
	const folders: string[] = [];
	const add = (read: () => unknown) => {
		try {
			const folder = read();
			if (typeof folder === "string" && folder.trim() !== "") folders.push(normalizePath(folder));
		} catch {
			// The plugin or its settings moved; its notes just aren't excluded.
		}
	};
	const coreOption = (id: string, key: string) => () => {
		const plugin = app.internalPlugins?.getPluginById?.(id);
		return plugin?.enabled ? plugin.instance?.options?.[key] : undefined;
	};
	add(coreOption("templates", "folder"));
	add(coreOption("daily-notes", "folder"));
	add(() => app.plugins?.plugins?.["templater-obsidian"]?.settings?.["templates_folder"]);
	return folders.filter((folder) => folder !== "/");
}

export function isInFolders(path: string, folders: string[]): boolean {
	if (path.startsWith(".trash/")) return true;
	return folders.some((folder) => path.startsWith(`${folder}/`));
}
