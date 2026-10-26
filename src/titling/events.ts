import { Plugin, TFile } from "obsidian";
import { AutoTitler } from "./autoTitler";

/**
 * Feeds the auto-titler what happens in the workspace: which note is open (and which was just
 * left), local edits, and renames and deletions. Only `editor-change` counts as typing, so notes
 * that change through sync never trigger anything here.
 */
export function registerTitlingEvents(plugin: Plugin, deps: {autoTitler: AutoTitler; onOnline: () => void}): void {
	const {workspace, vault} = plugin.app;
	let active: string | null = workspace.getActiveFile()?.path ?? null;
	if (active) void deps.autoTitler.seen(active);

	const switchTo = (path: string | null) => {
		if (path === active) return;
		if (active) deps.autoTitler.left(active);
		active = path;
		if (path) void deps.autoTitler.seen(path);
	};

	plugin.registerEvent(workspace.on("file-open", (file) => switchTo(file?.path ?? null)));
	plugin.registerEvent(workspace.on("active-leaf-change", () => switchTo(workspace.getActiveFile()?.path ?? null)));
	plugin.registerEvent(workspace.on("editor-change", (_editor, info) => {
		if (info.file instanceof TFile) deps.autoTitler.edited(info.file.path);
	}));
	plugin.registerEvent(vault.on("rename", (file, oldPath) => {
		deps.autoTitler.renamed(oldPath, file.path);
		if (active === oldPath) active = file.path;
	}));
	plugin.registerEvent(vault.on("delete", (file) => deps.autoTitler.deleted(file.path)));
	plugin.registerDomEvent(window, "online", deps.onOnline);
}
