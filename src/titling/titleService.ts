import { TitleFormat } from "../types";
import { MAX_PROMPT_CHARS } from "../constants";
import { LruCache } from "../core/util/lru";
import { hashText } from "../core/text/hash";
import { toPlainText } from "../core/text/plainText";
import { createListStream, parseList } from "../core/title/parse";
import { finalizeTitles } from "../core/title/postprocess";
import { buildTitleRequest } from "../core/title/request";
import { GenerationCancelledError, GenerateOptions } from "../generation/engine";
import { GenerationRequest, GenerationResult, Lane } from "../generation/protocol";

/** The part of the engine titles need. */
export type TitleEngine = {
	config(): {id: string};
	generate(request: GenerationRequest, options: GenerateOptions): Promise<GenerationResult>;
};

export type SuggestTitlesRequest = {
	/** The note's markdown, as it is now (the editor's content when the note is open). */
	markdown: string;
	/** The note's current name: never suggested, and a first heading repeating it is ignored. */
	currentName: string;
	format: TitleFormat;
	lane: Lane;
	/** Aborting stops this request; the generation stops too once nobody else waits for it. */
	signal?: AbortSignal;
	/** Called with the titles so far each time the list grows, as the reply streams in. */
	onTitles?: (titles: string[]) => void;
};

type InFlight = {
	controller: AbortController;
	waiting: number;
	/** Raw list items so far. */
	items: string[];
	listeners: Set<(items: string[]) => void>;
	done: Promise<string[]>;
};

const CACHED_REPLIES = 200;

function cancelled(): GenerationCancelledError {
	return new GenerationCancelledError();
}

/** The note's text as the model reads it: plain, and cut to what the prompt can hold. */
export function noteTextFor(markdown: string, currentName: string): string {
	return toPlainText(markdown, {currentName}).slice(0, MAX_PROMPT_CHARS);
}

/**
 * Turns notes into title suggestions. Replies are cached by model, format and note text, so the
 * popup reopening, or the auto-title that follows it, costs nothing; identical requests that
 * overlap share one generation, which stops only when every one of them has given up on it.
 */
export class TitleService {
	private readonly cache = new LruCache<string, string[]>(CACHED_REPLIES);
	private readonly inFlight = new Map<string, InFlight>();

	constructor(private readonly deps: {engine: TitleEngine; untitledNames: () => string[]}) {
	}

	/** Titles for the note, best first; resolves once the reply is complete. */
	async suggest(request: SuggestTitlesRequest): Promise<string[]> {
		if (request.signal?.aborted) throw cancelled();
		const text = noteTextFor(request.markdown, request.currentName);
		const finalize = (items: string[]) => finalizeTitles(items, {
			format: request.format,
			sourceText: text,
			exclude: [request.currentName, ...this.deps.untitledNames()],
		});

		const key = hashText([this.deps.engine.config().id, request.format.casing, request.format.length, request.format.style, text].join("\u0000"));
		const cached = this.cache.get(key);
		if (cached) {
			const titles = finalize(cached);
			request.onTitles?.(titles);
			return titles;
		}

		const flight = this.inFlight.get(key) ?? this.start(key, text, request);
		flight.waiting++;

		let shown = 0;
		const listener = (items: string[]) => {
			const titles = finalize(items);
			if (titles.length <= shown) return;
			shown = titles.length;
			request.onTitles?.(titles);
		};
		flight.listeners.add(listener);
		if (flight.items.length) listener(flight.items);

		const onAbort = () => {
			flight.listeners.delete(listener);
			if (--flight.waiting === 0) flight.controller.abort();
		};
		request.signal?.addEventListener("abort", onAbort, {once: true});

		try {
			const items = await Promise.race([
				flight.done,
				new Promise<never>((_, reject) => request.signal?.addEventListener("abort", () => reject(cancelled()), {once: true})),
			]);
			listener(items);
			return finalize(items);
		} finally {
			request.signal?.removeEventListener("abort", onAbort);
			if (!request.signal?.aborted) {
				flight.listeners.delete(listener);
				flight.waiting--;
			}
		}
	}

	/** Forgets cached replies, e.g. after the title format changed. */
	clear(): void {
		this.cache.clear();
	}

	private start(key: string, text: string, request: SuggestTitlesRequest): InFlight {
		const controller = new AbortController();
		const stream = createListStream();
		const flight: InFlight = {controller, waiting: 0, items: [], listeners: new Set(), done: Promise.resolve([])};

		flight.done = this.deps.engine.generate(buildTitleRequest(request.format, text), {
			lane: request.lane,
			signal: controller.signal,
			onDelta: (delta) => {
				if (stream.push(delta).length === 0) return;
				flight.items = stream.items();
				for (const listener of flight.listeners) listener(flight.items);
			},
		}).then((result) => {
			// The whole reply is the source of truth; the stream only fed the early updates.
			const items = parseList(result.text);
			this.cache.set(key, items);
			return items;
		}).finally(() => {
			this.inFlight.delete(key);
		});

		// Nobody may be waiting by the time it settles (all aborted): don't leave the rejection unhandled.
		flight.done.catch(() => {});
		this.inFlight.set(key, flight);
		return flight;
	}
}
