import { OBSIDIAN_UNTITLED_NAMES } from "../core/rules/untitled";

const UNTITLED_KEY = "plugins.file-explorer.label-untitled-file";

/** Every name that means "not named yet": Obsidian's in all languages (its current one first), plus the user's own. */
export function untitledNames(extra: string[]): string[] {
	let localized: string | undefined;
	try {
		const value = window.i18next?.t(UNTITLED_KEY);
		if (value && value !== UNTITLED_KEY) localized = value;
	} catch {
		// i18next is private API; the bundled list covers every shipped language anyway.
	}
	return [...new Set([...(localized ? [localized] : []), ...OBSIDIAN_UNTITLED_NAMES, ...extra])];
}
