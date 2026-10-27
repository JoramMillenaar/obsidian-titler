import { TitleFormat } from "../types";
import { titleKey } from "../core/title/postprocess";

/** The most titles one note keeps: a first batch and a few rounds of "Generate more". */
export const MAX_REMEMBERED_TITLES = 12;

type Remembered = {title: string; key: string; words: number; format: string};

const formatKey = ({casing, length, style}: TitleFormat) => `${casing}/${length}/${style}`;

/**
 * The titles the AI came up with for each note this session, to name it automatically or in the
 * popup, so the popup can offer them again (the ones an automatic name passed over included)
 * without asking the model. A title is kept until the note has more than doubled since it was
 * thought up, when the note is about more than the title knew, or until the title format changes.
 */
export class TitleMemory {
	private readonly notes = new Map<string, Remembered[]>();

	/** The titles kept for `path`, oldest first, now that the note is `words` long. */
	recall(path: string, words: number, format: TitleFormat): string[] {
		const kept = (this.notes.get(path) ?? []).filter((entry) => entry.format === formatKey(format) && words <= entry.words * 2);
		if (kept.length) this.notes.set(path, kept);
		else this.notes.delete(path);
		return kept.map((entry) => entry.title);
	}

	/** Keeps `titles`, thought up when the note was `words` long, after the ones it has. */
	add(path: string, titles: string[], words: number, format: TitleFormat): void {
		const entries = this.notes.get(path) ?? [];
		const known = new Set(entries.map((entry) => entry.key));
		for (const title of titles) {
			const key = titleKey(title);
			if (!key || known.has(key)) continue;
			known.add(key);
			entries.push({title, key, words, format: formatKey(format)});
		}
		if (entries.length) this.notes.set(path, entries.slice(-MAX_REMEMBERED_TITLES));
	}

	renamed(oldPath: string, newPath: string): void {
		const entries = this.notes.get(oldPath);
		if (!entries) return;
		this.notes.delete(oldPath);
		this.notes.set(newPath, entries);
	}

	deleted(path: string): void {
		this.notes.delete(path);
	}
}
