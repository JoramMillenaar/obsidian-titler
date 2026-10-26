import { TitleFormat } from "../../types";
import { TITLE_COUNT } from "../../constants";
import { GenerationRequest } from "../../generation/protocol";
import { detectLanguage } from "../text/language";
import { buildTitleMessages, maxNewTokens, NOTE_MARKER } from "./prompt";

/**
 * How much of the note decides its language: the opening, which sets the topic. A note that starts
 * in English and quotes a long Dutch message is an English note about that message.
 */
const LANGUAGE_SAMPLE_CHARS = 2000;

/**
 * The request that asks the model for titles for `noteText` (plain text, see toPlainText). The
 * prompt names the note's language when it can be told, since some models otherwise answer in English.
 */
export function buildTitleRequest(format: TitleFormat, noteText: string): GenerationRequest {
	return {
		messages: buildTitleMessages(format, {languageHint: detectLanguage(noteText.slice(0, LANGUAGE_SAMPLE_CHARS))?.name}),
		note: {marker: NOTE_MARKER, text: noteText},
		params: {maxNewTokens: maxNewTokens(format), stopAfterItems: TITLE_COUNT},
	};
}
