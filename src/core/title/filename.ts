import { MAX_TITLE_CHARS } from "../../constants";

// Obsidian refuses `* " \ / < > : | ?` in file names on every platform, and `# ^ [ ] |` break links.
const RESERVED_WINDOWS_NAMES = /^(con|prn|aux|nul|com\d|lpt\d)$/i;

/** Cuts `text` to `max` characters at a word boundary when there is one. */
function truncate(text: string, max: number): string {
	if (text.length <= max) return text;
	const cut = text.slice(0, max);
	const lastSpace = cut.lastIndexOf(" ");
	return (lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).trim();
}

/**
 * Makes `title` usable as a note's file name, keeping it readable: a colon becomes a dash and
 * brackets become parentheses rather than disappearing. Returns "" when nothing usable is left.
 */
export function sanitizeFileName(title: string): string {
	const cleaned = title
		.replace(/\p{Cc}/gu, " ")
		.replace(/\s*:\s*/g, " - ")
		.replace(/\[/g, "(")
		.replace(/]/g, ")")
		.replace(/[*"\\/<>|?#^]/g, "")
		.replace(/\s+/g, " ")
		.trim()
		.replace(/^[.\s-]+/, "")
		.replace(/[.\s]+$/, "");

	const name = truncate(cleaned, MAX_TITLE_CHARS).replace(/[.\s-]+$/, "");
	return RESERVED_WINDOWS_NAMES.test(name) ? "" : name;
}

/**
 * `name`, or the first of "name 1", "name 2", … not in `takenLower` (lowercased names already in
 * the folder: file systems on macOS and Windows treat names that differ only in case as the same).
 */
export function resolveAvailableName(name: string, takenLower: ReadonlySet<string>): string {
	if (!takenLower.has(name.toLocaleLowerCase())) return name;
	for (let n = 1; ; n++) {
		const candidate = `${name} ${n}`;
		if (!takenLower.has(candidate.toLocaleLowerCase())) return candidate;
	}
}

/**
 * The name to give a note: the first suggestion that is free, both as a file in its folder and as
 * a link target elsewhere in the vault (a second "Ideas" would make [[Ideas]] ambiguous). When
 * every suggestion is taken, the first one with a number.
 */
export function chooseName(titles: string[], takenLower: ReadonlySet<string>, isLinkTaken: (name: string) => boolean): string | null {
	const free = titles.find((title) => !takenLower.has(title.toLocaleLowerCase()) && !isLinkTaken(title));
	if (free) return free;
	const first = titles[0];
	return first === undefined ? null : resolveAvailableName(first, takenLower);
}
