import { stripFencedCode, stripFrontmatter, toPlainText } from "../text/plainText";
import { words } from "../text/words";

export type HeuristicTitle = {title: string; source: "heading" | "line"};

const MAX_HEURISTIC_WORDS = 10;

/**
 * An instant suggestion that needs no model: the note's first heading, else the first sentence
 * of its first line, when that is short enough to be a title.
 */
export function heuristicTitle(markdown: string): HeuristicTitle | null {
	const body = stripFencedCode(stripFrontmatter(markdown.replace(/\r\n?/g, "\n")));

	for (const line of body.split("\n")) {
		const heading = /^\s{0,3}#{1,6}\s+(.+)$/.exec(line);
		if (!heading?.[1]) continue;
		const title = toPlainText(heading[1]).trim();
		if (title) return {title, source: "heading"};
	}

	const firstLine = toPlainText(body).split("\n").find((line) => line.trim() !== "");
	if (!firstLine) return null;
	const sentence = (firstLine.split(/[.!?。！？](\s|$)/)[0] ?? firstLine).trim();
	const count = words(sentence).length;
	if (count === 0 || count > MAX_HEURISTIC_WORDS) return null;
	return {title: sentence, source: "line"};
}
