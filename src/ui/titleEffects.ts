import { MarkdownView, Plugin } from "obsidian";
import { titleElementsFor } from "../obsidian/titleElements";

const NAMING_CLASS = "titler-naming";
const REVEAL_CLASS = "titler-reveal";
/** How long the reveal takes per character, within bounds (styles.css draws it). */
const REVEAL_MS_PER_CHAR = 22;
const REVEAL_MIN_MS = 320;
const REVEAL_MAX_MS = 900;

/**
 * How far a title's text reaches from the start of its line, in pixels. Title elements are as wide
 * as the view, so effects sized to the element would mostly play over empty space.
 */
function textWidth(el: HTMLElement): number {
	const range = el.doc.createRange();
	range.selectNodeContents(el);
	const text = range.getBoundingClientRect();
	const box = el.getBoundingClientRect();
	const rtl = el.win.getComputedStyle(el).direction === "rtl";
	return Math.max(0, Math.ceil(rtl ? box.right - text.left : text.right - box.left));
}

/**
 * Plays a title's new text in: it sweeps in from the start of the line, as if written. CSS only (a
 * mask), so the text, which Obsidian saves on blur, is never touched.
 */
export function playReveal(el: HTMLElement): void {
	const duration = Math.min(REVEAL_MAX_MS, Math.max(REVEAL_MIN_MS, (el.textContent ?? "").length * REVEAL_MS_PER_CHAR));
	el.setCssProps({"--titler-reveal-width": `${textWidth(el)}px`, "--titler-reveal-duration": `${duration}ms`});
	el.addClass(REVEAL_CLASS);

	const done = () => {
		el.removeClass(REVEAL_CLASS);
		el.removeEventListener("animationend", onEnd);
		window.clearTimeout(timer);
	};
	const onEnd = (evt: AnimationEvent) => {
		if (evt.target === el) done();
	};
	el.addEventListener("animationend", onEnd);
	// A title that isn't shown (a background tab) never runs the animation: don't leave the mask on it.
	const timer = window.setTimeout(done, duration + 500);
}

/**
 * What a note's titles show while the AI names it: a shimmer as it thinks, then the new name
 * sweeping in. Only on views that show that note, which they may stop doing mid-way.
 */
export class TitleEffects {
	/** How many namings are under way per note: one asked for can overlap an automatic one. */
	private readonly naming = new Map<string, number>();

	constructor(private readonly plugin: Plugin) {
		plugin.registerEvent(plugin.app.workspace.on("file-open", () => this.sync()));
		plugin.registerEvent(plugin.app.workspace.on("layout-change", () => this.sync()));
	}

	/** The AI started or stopped thinking of a name for `path`. */
	setNaming(path: string, naming: boolean): void {
		const count = (this.naming.get(path) ?? 0) + (naming ? 1 : -1);
		if (count > 0) this.naming.set(path, count);
		else this.naming.delete(path);
		this.sync();
	}

	/** Plays the new name in on every open title of `path`. */
	reveal(path: string): void {
		for (const view of this.views()) {
			if (view.file?.path === path) titleElementsFor(view).forEach(playReveal);
		}
	}

	dispose(): void {
		this.naming.clear();
		this.sync();
	}

	private sync(): void {
		for (const view of this.views()) {
			const naming = view.file !== null && this.naming.has(view.file.path);
			for (const el of titleElementsFor(view)) {
				if (naming && !el.hasClass(NAMING_CLASS)) el.setCssProps({"--titler-text-width": `${textWidth(el)}px`});
				el.toggleClass(NAMING_CLASS, naming);
			}
		}
	}

	private views(): MarkdownView[] {
		return this.plugin.app.workspace.getLeavesOfType("markdown")
			.map((leaf) => leaf.view)
			.filter((view): view is MarkdownView => view instanceof MarkdownView);
	}
}
