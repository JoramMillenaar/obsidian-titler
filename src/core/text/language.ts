/**
 * Which language a note is in, so the prompt can name it: some models ignore "the same language
 * as the note" and answer in English. Scripts identify the languages that have one of their own;
 * stopwords tell the common Latin-script ones apart. When it can't tell confidently it returns
 * null, and the prompt falls back to "the same language as the note": a wrong hint is worse than none.
 */

export type Language = {code: string; name: string};

const NAMES: Record<string, string> = {
	en: "English", nl: "Dutch", de: "German", fr: "French", es: "Spanish", it: "Italian",
	pt: "Portuguese", sv: "Swedish", pl: "Polish", zh: "Chinese", ja: "Japanese", ko: "Korean",
	el: "Greek", he: "Hebrew", th: "Thai",
};

// Scripts used by one language only. Cyrillic, Arabic and Devanagari serve several, so they get no hint.
const SCRIPTS: [RegExp, string][] = [
	[/[\p{Script=Hiragana}\p{Script=Katakana}]/u, "ja"],
	[/\p{Script=Hangul}/u, "ko"],
	[/\p{Script=Han}/u, "zh"],
	[/\p{Script=Greek}/u, "el"],
	[/\p{Script=Hebrew}/u, "he"],
	[/\p{Script=Thai}/u, "th"],
];
const OTHER_SCRIPTS = /[\p{Script=Cyrillic}\p{Script=Arabic}\p{Script=Devanagari}]/u;

// Frequent function words. Ones several languages share ("de", "en", "la") are listed for each of
// them, so they don't tip the balance; the distinctive ones ("het", "und", "the") decide.
const STOPWORDS: Record<string, Set<string>> = {
	en: new Set("the and of to a in is that it for with on this was are you not be have but they we what how".split(" ")),
	nl: new Set("de het een en van is dat niet op te met voor zijn er maar ook als bij ik je wat hoe ze we die dit naar om".split(" ")),
	de: new Set("der die das und ist nicht ein eine zu mit sich auf für den von ich auch es dem wie was sie wir im dass".split(" ")),
	fr: new Set("le la les et est un une des du de que pas pour dans qui sur avec je il au en nous ce mais".split(" ")),
	es: new Set("el la los las y es un una que de en no por con para se del lo su al como pero muy".split(" ")),
	it: new Set("il la di che è e un una per non con sono del della lo gli si al come anche nel in".split(" ")),
	pt: new Set("o a os as e é um uma que de não para com do da em se no na ao como mas".split(" ")),
	sv: new Set("och att det är en som på för med av inte jag har till den om men var kan".split(" ")),
	pl: new Set("i w nie na się jest że z do to jak co ale tak od po".split(" ")),
};

const MIN_HITS = 4;
/** The best language needs this many times the runner-up's hits. */
const MIN_MARGIN = 1.5;

export function language(code: string): Language {
	return {code, name: NAMES[code] ?? code};
}

/** The language of `text`, or null when there isn't enough to tell confidently. */
export function detectLanguage(text: string, minHits = MIN_HITS): Language | null {
	const letters = [...text.replace(/[^\p{L}]/gu, "")];
	if (letters.length === 0) return null;
	for (const [script, code] of SCRIPTS) {
		if (letters.filter((char) => script.test(char)).length / letters.length > 0.3) return language(code);
	}
	if (letters.filter((char) => OTHER_SCRIPTS.test(char)).length / letters.length > 0.3) return null;

	const words = text.toLocaleLowerCase().match(/\p{L}+/gu) ?? [];
	const hits = Object.entries(STOPWORDS)
		.map(([code, set]) => ({code, hits: words.filter((word) => set.has(word)).length}))
		.sort((a, b) => b.hits - a.hits);
	const [best, second] = hits;
	if (!best || best.hits < minHits) return null;
	if (second && best.hits < second.hits * MIN_MARGIN) return null;
	return language(best.code);
}
