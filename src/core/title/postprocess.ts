import { TitleFormat } from "../../types";
import { TITLE_COUNT, TITLE_LENGTHS } from "../../constants";
import { isUnspacedScript, words } from "../text/words";
import { applyCasing } from "./casing";
import { sanitizeFileName } from "./filename";

const QUOTES = /^["'“”‘’«»„‚「」『』*_`]+|["'“”‘’«»„‚「」『』*_`]+$/g;
// Labels models put before a title. A colon inside a title ("Python: decorators") is kept.
const LABEL = /^(title|titel|titre|título|titolo|option|suggestion)\s*\d*\s*[:：-]\s*/i;
const EMOJI = /[\p{Extended_Pictographic}\u{FE0F}\u{200D}]/gu;
// Section headers models sometimes return as a "title", often lifted from the note's own template.
const GENERIC_TITLES = new Set([
	"note", "notes", "summary", "overview", "title", "titles", "idea", "ideas", "thoughts", "misc",
	"untitled", "introduction", "conclusion", "sources", "references", "quotes", "brainstorm",
	"description", "short description", "index", "draft", "todo", "tasks",
]);

/** One raw list item → a title candidate: markup, quotes, labels, emoji and end punctuation removed. */
export function cleanTitle(raw: string): string {
	return raw
		.replace(/\*\*|__|`/g, "")
		.replace(EMOJI, "")
		.replace(/(^|\s)#(?=[\p{L}\p{N}])/gu, "$1")
		.trim()
		.replace(QUOTES, "")
		.replace(LABEL, "")
		.replace(QUOTES, "")
		.replace(/[\s.,;:!…。、，；：！]+$/u, "")
		.replace(/\s+/g, " ")
		.trim();
}

/** For telling near-identical titles apart: case, accents and spacing ignored. */
export function titleKey(title: string): string {
	return title
		.normalize("NFD")
		.replace(/\p{M}/gu, "")
		.toLocaleLowerCase()
		.replace(/[^\p{L}\p{N}]+/gu, " ")
		.trim();
}

export type FinalizeContext = {
	format: TitleFormat;
	/** The note's text, so sentence case can keep the capitals the note itself uses. */
	sourceText: string;
	/** Titles not to suggest: the note's current name, untitled names, ones already shown. */
	exclude: string[];
	/** How many to keep. */
	limit?: number;
};

/**
 * Raw list items → the titles to offer, in order: cleaned, length-checked, cased, made safe as
 * file names, deduplicated. Over-long items are dropped rather than cut, since a cut title reads
 * broken; titles in scripts without spaces aren't word-counted.
 */
export function finalizeTitles(items: string[], context: FinalizeContext): string[] {
	const {maxWords} = TITLE_LENGTHS[context.format.length];
	const seen = new Set(context.exclude.map(titleKey));
	const titles: string[] = [];

	for (const item of items) {
		const cleaned = cleanTitle(item);
		if (!cleaned) continue;
		if (!isUnspacedScript(cleaned) && words(cleaned).length > Math.ceil(maxWords * 1.5)) continue;

		const title = sanitizeFileName(applyCasing(cleaned, context.format.casing, context.sourceText));
		const key = titleKey(title);
		if (!title || !key || seen.has(key) || GENERIC_TITLES.has(key)) continue;
		seen.add(key);
		titles.push(title);
		if (titles.length >= (context.limit ?? TITLE_COUNT)) break;
	}
	return titles;
}
