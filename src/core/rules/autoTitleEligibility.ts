/** Why a note isn't named automatically (now). */
export type AutoTitleSkip =
	| "off"
	| "not-markdown"
	| "named"
	| "excluded-folder"
	| "special-note"
	| "too-short"
	| "opted-out"
	| "editing-title";

export type AutoTitleFacts = {
	/** Auto-title is on, and the AI model is available on this device. */
	enabled: boolean;
	extension: string;
	isUntitled: boolean;
	/** In a templates or daily notes folder, or the trash. */
	inExcludedFolder: boolean;
	frontmatterKeys: string[];
	/** Words added since the note was first seen this session. */
	wordsTyped: number;
	minWords: number;
	/** The user undid an automatic name for this note this session. */
	optedOut: boolean;
	titleFocused: boolean;
};

// Notes other plugins own and store as markdown: their names are theirs.
const SPECIAL_NOTE_KEYS = ["excalidraw-plugin", "kanban-plugin"];

/** Whether an Untitled note should be named now; `editing-title` means try again once the user is done. */
export function decideAutoTitle(facts: AutoTitleFacts): {ok: true} | {ok: false; skip: AutoTitleSkip} {
	const skip = (reason: AutoTitleSkip) => ({ok: false as const, skip: reason});
	if (!facts.enabled) return skip("off");
	if (facts.extension !== "md") return skip("not-markdown");
	if (!facts.isUntitled) return skip("named");
	if (facts.inExcludedFolder) return skip("excluded-folder");
	if (facts.frontmatterKeys.some((key) => SPECIAL_NOTE_KEYS.includes(key))) return skip("special-note");
	if (facts.optedOut) return skip("opted-out");
	if (facts.wordsTyped < facts.minWords) return skip("too-short");
	if (facts.titleFocused) return skip("editing-title");
	return {ok: true};
}
