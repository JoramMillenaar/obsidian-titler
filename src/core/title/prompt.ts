import { Casing, ChatMessage, TitleFormat, TitleLength, TitleStyle } from "../../types";
import { TITLE_COUNT, TITLE_LENGTHS } from "../../constants";

/** Where the note's text goes in the prompt. The worker fills it in after cutting the note to the model's token budget. */
export const NOTE_MARKER = "{{NOTE}}";

// No example titles here: small models copy an example into their answer for unrelated notes.
export const STYLE_INSTRUCTIONS: Record<TitleStyle, string> = {
	topic: "Each title names the note's main topic as a short noun phrase, the way a heading would.",
	claim: "Each title states the note's main idea or conclusion as a short, specific statement.",
	question: "Each title is the main question the note answers.",
};

export const CASING_INSTRUCTIONS: Record<Casing, string> = {
	sentence: "Use sentence case.",
	title: "Use Title Case.",
	lower: "Use lowercase.",
};

export function lengthInstruction(length: TitleLength): string {
	const {minWords, maxWords} = TITLE_LENGTHS[length];
	return length === "long"
		? `Use at most ${maxWords} words per title.`
		: `Use ${minWords} to ${maxWords} words per title.`;
}

export type PromptOptions = {
	count?: number;
	/** Name of the note's language, when known, to keep small models from answering in English. */
	languageHint?: string;
};

export function systemPrompt(format: TitleFormat, options: PromptOptions = {}): string {
	const count = options.count ?? TITLE_COUNT;
	const language = options.languageHint
		? `Write the titles in ${options.languageHint}, the language of the note.`
		: "Write the titles in the same language as the note.";
	return [
		`You name notes. Read the note and reply with exactly ${count} different titles for it, one per line, numbered 1. to ${count}.`,
		STYLE_INSTRUCTIONS[format.style],
		lengthInstruction(format.length),
		CASING_INSTRUCTIONS[format.casing],
		language,
		"Be specific to what this note is about, in your own words rather than a line copied from it.",
		"No quotes, emojis, hashtags or final punctuation. Reply with the list only.",
	].join(" ");
}

export function userPrompt(): string {
	return `<note>\n${NOTE_MARKER}\n</note>`;
}

/** The chat that asks for titles; the note itself goes in at {@link NOTE_MARKER}. */
export function buildTitleMessages(format: TitleFormat, options: PromptOptions = {}): ChatMessage[] {
	return [
		{role: "system", content: systemPrompt(format, options)},
		{role: "user", content: userPrompt()},
	];
}

/** Output budget for one reply: the list, numbering and line breaks included. */
export function maxNewTokens(format: TitleFormat): number {
	return TITLE_LENGTHS[format.length].maxNewTokens;
}
