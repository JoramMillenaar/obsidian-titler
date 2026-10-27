import { TitleFormat } from "../../types";
import { MORE_TITLE_COUNT, TITLE_COUNT } from "../../constants";
import { GenerationRequest } from "../../generation/protocol";
import { detectLanguage } from "../text/language";
import { buildTitleMessages, maxNewTokens, NOTE_MARKER } from "./prompt";

/**
 * How much of the note decides its language: the opening, which sets the topic. A note that starts
 * in English and quotes a long Dutch message is an English note about that message.
 */
const LANGUAGE_SAMPLE_CHARS = 2000;

export type TitleRequestOptions = {
	/**
	 * Asking for more: the titles offered already, which the reply shouldn't repeat. It's sampled,
	 * and asks for a few extra in case some repeat anyway.
	 */
	avoid?: string[];
	/** Titles that won't be offered whatever the model says: the note's current name, "Untitled". */
	exclude?: string[];
};

/**
 * The request that asks the model for titles for `noteText` (plain text, see toPlainText). The
 * prompt names the note's language when it can be told, since some models otherwise answer in English.
 * The reply stops once it holds TITLE_COUNT titles that will be offered, not counting ones filtered out.
 */
export function buildTitleRequest(format: TitleFormat, noteText: string, {avoid, exclude = []}: TitleRequestOptions = {}): GenerationRequest {
	const count = avoid ? MORE_TITLE_COUNT : TITLE_COUNT;
	return {
		messages: buildTitleMessages(format, {languageHint: detectLanguage(noteText.slice(0, LANGUAGE_SAMPLE_CHARS))?.name, avoid, count}),
		note: {marker: NOTE_MARKER, text: noteText},
		params: {
			maxNewTokens: Math.ceil(maxNewTokens(format) * count / TITLE_COUNT),
			stopAfterItems: TITLE_COUNT,
			countTitles: {format, exclude: [...exclude, ...(avoid ?? [])]},
			sample: avoid !== undefined,
		},
	};
}
