/**
 * Turns a model's reply into list items as it streams in. Models answer a "numbered list" request
 * in many shapes: `1. A`, `1) A`, `1 A`, `- A`, `**1.** A`, all three on one line, a "Here are
 * three titles:" preamble or a lone "Notes" header first, a closing remark after. Items are
 * returned raw (marker removed); see postprocess.ts for cleaning them into titles. Pure: the
 * worker counts items with it to stop early.
 */

export type ListStream = {
	/** Feeds the next piece of text; returns the items it completed. */
	push(delta: string): string[];
	/** Ends the stream; returns the items the last, unterminated line held. */
	finish(): string[];
	/** Items so far, by the same rule as {@link items}. */
	readonly count: number;
	/**
	 * The reply's items. Once a reply uses list markers, its unmarked lines are headers and
	 * remarks, not items; a reply without any markers is read line by line.
	 */
	items(): string[];
};

type ListItem = {text: string; marked: boolean};

const NUMBERED = /^\**\s*(\d{1,2})\s*[.):\]]\**\s*(.*)$/;
// "1 Title": numbering without punctuation, trusted only when the number is the item's position.
const BARE_NUMBERED = /^(\d{1,2})\s+(\S.*)$/;
const BULLETED = /^[-*•–—]\s+(.*)$/;
// "1. A 2. B 3. C" on one line: split before every later marker.
const INLINE_MARKER = /\s+(?=\d{1,2}[.)]\s)/;
const MAX_PLAIN_ITEM_WORDS = 16;

/**
 * The items one line holds: none for preambles, remarks and blank lines. `position` is the
 * number the next item would have, so "3 ways to …" as a first item keeps its number.
 */
function parseLine(line: string, position: number): ListItem[] {
	const trimmed = line.trim();
	if (trimmed === "") return [];

	const numbered = NUMBERED.exec(trimmed);
	if (numbered) {
		const parts = (numbered[2] ?? "").split(INLINE_MARKER);
		return parts
			.map((part, index) => (index === 0 ? part : part.replace(/^\d{1,2}[.)]\s+/, "")).trim())
			.filter((part) => part !== "")
			.map((text) => ({text, marked: true}));
	}

	const bare = BARE_NUMBERED.exec(trimmed);
	if (bare?.[2] && Number(bare[1]) === position) return [{text: bare[2].trim(), marked: true}];

	const bulleted = BULLETED.exec(trimmed);
	if (bulleted) return bulleted[1]?.trim() ? [{text: bulleted[1].trim(), marked: true}] : [];

	// An unmarked line: a title if it's short and doesn't introduce something.
	if (/[:：]$/.test(trimmed)) return [];
	if (trimmed.split(/\s+/).length > MAX_PLAIN_ITEM_WORDS) return [];
	return [{text: trimmed, marked: false}];
}

/** The items one line holds, read as the first line of a reply. */
export function parseListLine(line: string): string[] {
	return parseLine(line, 1).map((item) => item.text);
}

/** Removes `<think>…</think>` reasoning, including an unterminated block at the end. */
export function stripThinking(text: string): string {
	return text.replace(/<think>[\s\S]*?(<\/think>|$)/g, "");
}

export function createListStream(): ListStream {
	let raw = "";
	let consumed = 0;
	const marked: string[] = [];
	const plain: string[] = [];

	const take = (lines: string[]): string[] => {
		const completed: string[] = [];
		for (const line of lines) {
			for (const item of parseLine(line, marked.length + 1)) {
				if (item.marked) {
					marked.push(item.text);
					completed.push(item.text);
				} else {
					plain.push(item.text);
					// After the first marked item, unmarked lines are remarks; before it, they may still be items.
					if (marked.length === 0) completed.push(item.text);
				}
			}
		}
		return completed;
	};

	return {
		push(delta: string): string[] {
			raw += delta;
			// An open reasoning block hides everything after it, so lines inside it never count as final.
			const visible = stripThinking(raw);
			const lastNewline = visible.lastIndexOf("\n");
			if (lastNewline < consumed) return [];
			const complete = visible.slice(consumed, lastNewline + 1);
			consumed = lastNewline + 1;
			return take(complete.split("\n"));
		},
		finish(): string[] {
			const visible = stripThinking(raw);
			const rest = visible.slice(consumed);
			consumed = visible.length;
			return take(rest.split("\n"));
		},
		get count() {
			return marked.length || plain.length;
		},
		items(): string[] {
			return marked.length ? [...marked] : [...plain];
		},
	};
}

/** Every item in a complete reply. */
export function parseList(text: string): string[] {
	const stream = createListStream();
	stream.push(text);
	stream.finish();
	return stream.items();
}
