import { GenerationParams } from "../../generation/protocol";
import { ListStream } from "./parse";
import { finalizeTitles } from "./postprocess";

/**
 * Whether a reply streaming in has what was asked for: `stopAfterItems` list items, or with
 * `countTitles`, that many that make titles which will be offered. Pure: the worker checks it as
 * each line of the reply completes.
 */
export function hasEnoughItems(list: ListStream, params: GenerationParams, noteText: string): boolean {
	const {stopAfterItems, countTitles} = params;
	if (list.count < stopAfterItems) return false;
	if (!countTitles) return true;
	const titles = finalizeTitles(list.items(), {
		format: countTitles.format,
		sourceText: noteText,
		exclude: countTitles.exclude,
		limit: stopAfterItems,
	});
	return titles.length >= stopAfterItems;
}
