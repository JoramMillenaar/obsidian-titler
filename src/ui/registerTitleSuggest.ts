import { MarkdownView, Plugin, TFile, WorkspaceLeaf } from "obsidian";
import { primaryTitleElement, titleElementsFor } from "../obsidian/titleElements";
import { TitleSuggest, TitleSuggestDeps } from "./TitleSuggest";

export type RegisterTitleSuggestDeps = TitleSuggestDeps & {
	/** Loads the model ahead of the request, when that won't start a download. */
	prewarm: () => void;
	/** The user started or stopped editing `file`'s name. */
	onTitleFocus?: (file: TFile) => void;
	onTitleBlur?: (file: TFile) => void;
};

type Attached = {suggest: TitleSuggest; el: HTMLElement; detach: () => void};

/**
 * Puts title suggestions on every open note's editable titles: the inline title and the one in
 * the tab header (for people who hide the inline title). Returns a way to open them from a command.
 */
export function registerTitleSuggest(plugin: Plugin, deps: RegisterTitleSuggestDeps): {open(view: MarkdownView): boolean} {
	const attached = new Map<HTMLElement, Attached>();

	const viewOf = (leaf: WorkspaceLeaf) => () => (leaf.view instanceof MarkdownView ? leaf.view : null);

	const attachTo = (leaf: WorkspaceLeaf, el: HTMLElement) => {
		const getView = viewOf(leaf);
		const suggest = new TitleSuggest(plugin.app, el, getView, deps);
		const onFocus = () => {
			const file = getView()?.file;
			deps.prewarm();
			suggest.begin();
			if (file) deps.onTitleFocus?.(file);
		};
		const onBlur = () => {
			const file = getView()?.file;
			suggest.end();
			if (file) deps.onTitleBlur?.(file);
		};
		el.addEventListener("focus", onFocus);
		el.addEventListener("blur", onBlur);
		attached.set(el, {
			suggest,
			el,
			detach: () => {
				el.removeEventListener("focus", onFocus);
				el.removeEventListener("blur", onBlur);
				suggest.dispose();
			},
		});
	};

	const sync = () => {
		// Views that closed take their titles with them.
		for (const [el, entry] of attached) {
			if (el.isConnected) continue;
			entry.detach();
			attached.delete(el);
		}
		for (const leaf of plugin.app.workspace.getLeavesOfType("markdown")) {
			if (!(leaf.view instanceof MarkdownView)) continue;
			for (const el of titleElementsFor(leaf.view)) {
				if (!attached.has(el)) attachTo(leaf, el);
			}
		}
	};

	plugin.registerEvent(plugin.app.workspace.on("layout-change", sync));
	plugin.registerEvent(plugin.app.workspace.on("active-leaf-change", sync));
	plugin.registerEvent(plugin.app.workspace.on("file-open", sync));
	plugin.app.workspace.onLayoutReady(sync);
	plugin.register(() => {
		for (const entry of attached.values()) entry.detach();
		attached.clear();
	});

	return {
		open(view: MarkdownView): boolean {
			sync();
			const el = primaryTitleElement(view);
			if (!el) return false;
			el.focus();
			return true;
		},
	};
}
