// Scripts written without spaces between words: each character counts as a word.
const UNSPACED = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Thai}]/u;
const TOKEN = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Thai}]|[\p{L}\p{N}][\p{L}\p{N}\p{M}'’-]*/gu;

/** Words in `text`, counting each Chinese/Japanese/Thai character as one. */
export function countWords(text: string): number {
	return [...text.matchAll(TOKEN)].length;
}

/** The words of `text` (letters and digits, apostrophes and hyphens inside a word kept). */
export function words(text: string): string[] {
	return [...text.matchAll(TOKEN)].map((match) => match[0]);
}

export function isUnspacedScript(text: string): boolean {
	return UNSPACED.test(text);
}
