import { Casing } from "../../types";

/**
 * Casing is applied here rather than trusted to the model: small models drift between styles.
 * Words with deliberate casing (acronyms like "AI", brands like "iPhone" or "macOS") are kept.
 */

const WORD = /[\p{L}\p{N}][\p{L}\p{N}'’]*/gu;

// English words Title Case leaves lowercase unless they open or close the title.
const SMALL_WORDS = new Set([
	"a", "an", "and", "as", "at", "but", "by", "for", "from", "in", "into", "nor", "of", "on",
	"or", "over", "per", "so", "the", "to", "up", "via", "vs", "with", "yet",
]);

function isCapitalized(word: string): boolean {
	const first = word.charAt(0);
	const rest = word.slice(1);
	return first !== first.toLocaleLowerCase() && rest === rest.toLocaleLowerCase();
}

/** "AI", "iPhone", "macOS", "GPT4": casing that carries meaning. */
function hasDeliberateCasing(word: string): boolean {
	const rest = word.slice(1);
	return rest !== rest.toLocaleLowerCase();
}

function capitalize(word: string): string {
	return word.charAt(0).toLocaleUpperCase() + word.slice(1);
}

/**
 * The lines of `text` that read as prose. Headings and labels ("Technical Competence",
 * "Quotes") capitalize words that running text wouldn't, so they say nothing about casing.
 */
function proseLines(text: string): string[] {
	return text.split("\n").filter((line) => {
		const lineWords = line.match(WORD) ?? [];
		if (lineWords.length <= 1) return false;
		return lineWords.filter(isCapitalized).length / lineWords.length < 0.6;
	});
}

/** "Vonnegut's" → "Vonnegut": a name keeps its capital in the possessive, which the note may not use. */
function withoutPossessive(word: string): string {
	return word.replace(/['’]s$/iu, "");
}

/** How often `word` appears capitalized vs. lowercase in the prose of `text`, ignoring sentence-initial uses. */
function usageIn(text: string, word: string): {capitalized: number; lowercase: number} {
	const lower = withoutPossessive(word).toLocaleLowerCase();
	let capitalized = 0;
	let lowercase = 0;
	for (const line of proseLines(text)) {
		for (const match of line.matchAll(WORD)) {
			const candidate = withoutPossessive(match[0]);
			if (candidate.toLocaleLowerCase() !== lower) continue;
			const before = line.slice(Math.max(0, match.index - 3), match.index);
			const sentenceStart = match.index === 0 || /[.!?:]\s*$/.test(before);
			if (candidate === lower) lowercase++;
			else if (!sentenceStart && isCapitalized(candidate)) capitalized++;
		}
	}
	return {capitalized, lowercase};
}

function mapWords(title: string, map: (word: string, index: number, count: number) => string): string {
	const matches = [...title.matchAll(WORD)];
	let index = 0;
	return title.replace(WORD, (word) => map(word, index++, matches.length));
}

/**
 * Share of mid-sentence words the note's prose capitalizes: a few percent in English (names),
 * a quarter or more in German (every noun).
 */
function capitalizationRate(text: string): number {
	let capitalized = 0;
	let total = 0;
	for (const line of proseLines(text)) {
		for (const match of line.matchAll(WORD)) {
			const before = line.slice(Math.max(0, match.index - 3), match.index);
			if (match.index === 0 || /[.!?:]\s*$/.test(before)) continue;
			total++;
			if (isCapitalized(match[0])) capitalized++;
		}
	}
	return total === 0 ? 0 : capitalized / total;
}

// Above this, the note's language capitalizes nouns, so a capitalized word it doesn't use may be one too.
const NOUN_CAPITALIZING_RATE = 0.2;

/**
 * Sentence case: only the first word is capitalized. A later capitalized word stays when the note
 * itself mostly writes it capitalized (a name, a German noun); one the note doesn't use stays only
 * when the note's language capitalizes nouns.
 */
function toSentenceCase(title: string, sourceText: string): string {
	let nounCapitalizing: boolean | null = null;

	return mapWords(title, (word, index) => {
		if (hasDeliberateCasing(word)) return word;
		if (index === 0) return capitalize(word);
		if (!isCapitalized(word)) return word;
		const {capitalized, lowercase} = usageIn(sourceText, word);
		if (lowercase > capitalized) return word.toLocaleLowerCase();
		if (capitalized > 0) return word;
		nounCapitalizing ??= capitalizationRate(sourceText) > NOUN_CAPITALIZING_RATE;
		return nounCapitalizing ? word : word.toLocaleLowerCase();
	});
}

function toTitleCase(title: string): string {
	return mapWords(title, (word, index, count) => {
		if (hasDeliberateCasing(word)) return word;
		const small = SMALL_WORDS.has(word.toLocaleLowerCase());
		if (small && index > 0 && index < count - 1) return word.toLocaleLowerCase();
		return capitalize(word);
	});
}

export function applyCasing(title: string, casing: Casing, sourceText = ""): string {
	if (casing === "lower") return title.toLocaleLowerCase();
	if (casing === "title") return toTitleCase(title);
	return toSentenceCase(title, sourceText);
}
