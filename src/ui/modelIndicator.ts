import { Menu, MenuItem, Plugin, setIcon, setTooltip } from "obsidian";
import { EngineStatus } from "../generation/engine";
import { ModelDetails, modelMenu } from "../status/modelMessages";

export type ModelIndicatorDeps = {
	status: () => EngineStatus;
	subscribe: (listener: (status: EngineStatus) => void) => () => void;
	/** The model, and how long it stays in memory, as the menu describes it. */
	details: () => ModelDetails;
	/** Takes the model out of memory now (stopping a load); the next use loads it again. */
	unload: () => void;
};

/** The ring's arc while there's no telling how far along loading is: a spinning quarter. */
const INDETERMINATE_ARC = 25;
/** How often an open menu updates: its countdown counts seconds. */
const MENU_TICK_MS = 1000;

/**
 * A small icon in the status bar while the AI model is in memory: sparkles shimmering in the accent
 * color once it's loaded, a ring filling up while it loads. Selecting it opens a menu about the model, counting
 * down to when it unloads by itself, with a way to take it down now. Hidden while the model isn't in memory.
 */
export function registerModelIndicator(plugin: Plugin, deps: ModelIndicatorDeps): void {
	const el = plugin.addStatusBarItem();
	el.addClass("titler-model-indicator", "mod-clickable");
	setTooltip(el, "Titler AI model", {placement: "top"});

	const icon = el.createSpan({cls: "titler-model-icon"});
	setIcon(icon, "sparkles");
	const ring = el.createSvg("svg", {cls: "titler-model-ring", attr: {viewBox: "0 0 16 16", "aria-hidden": "true"}});
	ring.createSvg("circle", {cls: "titler-model-ring-track", attr: {cx: 8, cy: 8, r: 6}});
	// pathLength 100: the dash length is the percentage.
	const arc = ring.createSvg("circle", {cls: "titler-model-ring-arc", attr: {cx: 8, cy: 8, r: 6, pathLength: 100}});

	const paint = (status: EngineStatus) => {
		const loading = status.kind === "loading";
		el.toggle(loading || status.kind === "ready");
		el.toggleClass("is-ready", status.kind === "ready");
		el.toggleClass("is-loading", loading);
		el.toggleClass("is-indeterminate", loading && status.progress === null);
		if (loading) arc.setAttr("stroke-dasharray", `${status.progress ?? INDETERMINATE_ARC} 100`);
	};
	plugin.register(deps.subscribe(paint));

	plugin.registerDomEvent(el, "click", (evt) => {
		const content = modelMenu(deps.status(), deps.details());
		if (!content) return;
		// Obsidian's own menu even when native menus are on: a native one can't change once open, and the countdown ticks.
		const menu = new Menu().setUseNativeMenu(false);
		menu.addItem((item) => item.setTitle("Titler AI model").setIsLabel(true));
		const lines: MenuItem[] = [];
		for (const line of content.lines) menu.addItem((item) => lines.push(item.setTitle(line).setDisabled(true)));
		menu.addSeparator();
		menu.addItem((item) => item.setTitle(content.action).setIcon("power").onClick(() => deps.unload()));

		// Kept up to date while open (the countdown ticks); closed once it no longer says what's so.
		const tick = window.setInterval(() => {
			const current = modelMenu(deps.status(), deps.details());
			if (!current || current.lines.length !== lines.length || current.action !== content.action) {
				menu.hide();
				return;
			}
			current.lines.forEach((line, index) => lines[index]?.setTitle(line));
		}, MENU_TICK_MS);
		plugin.registerInterval(tick);
		menu.onHide(() => window.clearInterval(tick));
		menu.showAtMouseEvent(evt);
	});
}
