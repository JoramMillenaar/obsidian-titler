/**
 * Markdown → the plain text a title is written from. Pure string work, no rendering: a note's
 * meaning is in its words, and rendering would run Dataview queries and embeds for nothing.
 */

const FRONTMATTER = /^---\r?\n[\s\S]*?\r?\n---[ \t]*(\r?\n|$)/;

/** The note without its YAML frontmatter. */
export function stripFrontmatter(markdown: string): string {
	return markdown.replace(FRONTMATTER, "");
}

/** Drops fenced code blocks (``` or ~~~; a closing fence is at least as long as the opening one). */
export function stripFencedCode(markdown: string): string {
	const out: string[] = [];
	let fence: {char: string; length: number} | null = null;
	for (const line of markdown.split("\n")) {
		const match = /^\s{0,3}(`{3,}|~{3,})/.exec(line);
		if (fence) {
			if (match?.[1] && match[1][0] === fence.char && match[1].length >= fence.length && line.trim() === match[1]) fence = null;
			continue;
		}
		if (match?.[1]) {
			fence = {char: match[1].charAt(0), length: match[1].length};
			continue;
		}
		out.push(line);
	}
	return out.join("\n");
}

function linkLabel(target: string, alias: string | undefined): string {
	if (alias?.trim()) return alias.trim();
	const withoutHeading = target.split(/[#^]/)[0] ?? target;
	return (withoutHeading.split("/").pop() ?? withoutHeading).replace(/\.md$/i, "").trim();
}

/** Inline markup → its visible words. */
function stripInline(line: string): string {
	return line
		.replace(/!\[\[[^\]]*]]/g, "")
		.replace(/!\[[^\]]*]\([^)]*\)/g, "")
		.replace(/\[\[([^\]|]*)(?:\|([^\]]*))?]]/g, (_, target: string, alias?: string) => linkLabel(target, alias))
		.replace(/\[([^\]]*)]\([^)]*\)/g, "$1")
		.replace(/<https?:\/\/[^>]+>/g, "")
		.replace(/https?:\/\/\S+/g, "")
		.replace(/`([^`]*)`/g, "$1")
		.replace(/<[^>]+>/g, "")
		.replace(/(\*\*|__|~~|==)/g, "")
		.replace(/(^|[\s(])[*_](\S(?:[^*_]*\S)?)[*_](?=$|[\s).,;:!?])/g, "$1$2")
		.replace(/(^|\s)#([\p{L}\p{N}_/-]+)/gu, "$1$2")
		.replace(/\s\^[\w-]+\s*$/, "")
		.replace(/\[\^[^\]]*]/g, "");
}

/** Block markup at the start of a line → nothing, keeping the line's words. */
function stripBlockMarkers(line: string): string | null {
	if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) return null; // horizontal rule
	if (/^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/.test(line)) return null; // table separator
	return line
		.replace(/^\s*(>\s?)+/, "")
		.replace(/^\[![\w-]+][-+]?\s*/, "")
		.replace(/^#{1,6}\s+/, "")
		.replace(/^\s*([-*+]|\d+[.)])\s+(\[.]\s+)?/, "");
}

/** A table row's cells, joined. Runs after inline markup is gone, so a link alias's `|` is not a cell border. */
function joinTableCells(line: string): string {
	return line
		.replace(/^\s*\|/, "")
		.replace(/\|\s*$/, "")
		.replace(/\s*\\?\|\s*/g, " · ");
}

export type PlainTextOptions = {
	/** The note's current name: a first heading that only repeats it is dropped. */
	currentName?: string;
};

export function toPlainText(markdown: string, options: PlainTextOptions = {}): string {
	let text = stripFencedCode(stripFrontmatter(markdown.replace(/\r\n?/g, "\n")));
	text = text
		.replace(/%%[\s\S]*?(%%|$)/g, "")
		.replace(/<!--[\s\S]*?(-->|$)/g, "")
		.replace(/\$\$[\s\S]*?(\$\$|$)/g, "");

	const lines: string[] = [];
	let first = true;
	for (const raw of text.split("\n")) {
		if (first && raw.trim() !== "") {
			first = false;
			const heading = /^#\s+(.*)$/.exec(raw.trim());
			if (heading?.[1] && options.currentName && heading[1].trim().toLocaleLowerCase() === options.currentName.trim().toLocaleLowerCase()) continue;
		}
		const block = stripBlockMarkers(raw);
		if (block === null) continue;
		const inline = stripInline(block);
		const line = raw.trimStart().startsWith("|") ? joinTableCells(inline) : inline;
		lines.push(line.replace(/[ \t]+/g, " ").trim());
	}

	return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}
