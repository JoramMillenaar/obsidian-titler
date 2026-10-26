import { DType, GenerationModelConfig } from "../types";

/**
 * What transformers.js keeps in Cache Storage, under the plugin's own cache key (see
 * MODEL_CACHE_KEY), keyed by each file's Hugging Face URL. Cache Storage belongs to the app,
 * not the vault: a download is shared by every vault on this device.
 */

const urlPrefix = (config: GenerationModelConfig) => `https://huggingface.co/${config.repoId}/resolve/`;

/** Whether all weight files of any of the model's dtypes are cached. */
export async function isModelDownloaded(config: GenerationModelConfig, cacheKey: string): Promise<boolean> {
	if (typeof caches === "undefined") return false;
	try {
		const cache = await caches.open(cacheKey);
		for (const files of Object.values(config.weightFiles)) {
			if (!files?.length) continue;
			const found = await Promise.all(files.map((file) => cache.match(`${urlPrefix(config)}main/${file}`)));
			if (found.every((response) => response !== undefined)) return true;
		}
	} catch {
		// An unreadable cache reads as not downloaded: the cost is a download notice that wasn't needed.
	}
	return false;
}

/** The dtypes of the model whose weights are fully cached. */
export async function downloadedDtypes(config: GenerationModelConfig, cacheKey: string): Promise<DType[]> {
	if (typeof caches === "undefined") return [];
	const cache = await caches.open(cacheKey);
	const dtypes: DType[] = [];
	for (const [dtype, files] of Object.entries(config.weightFiles) as [DType, string[]][]) {
		const found = await Promise.all(files.map((file) => cache.match(`${urlPrefix(config)}main/${file}`)));
		if (found.every((response) => response !== undefined)) dtypes.push(dtype);
	}
	return dtypes;
}

/** Deletes every cached file of the model; returns how many were deleted. */
export async function deleteModelDownload(config: GenerationModelConfig, cacheKey: string): Promise<number> {
	if (typeof caches === "undefined") return 0;
	const cache = await caches.open(cacheKey);
	let deleted = 0;
	for (const request of await cache.keys()) {
		if (request.url.startsWith(urlPrefix(config)) && await cache.delete(request)) deleted++;
	}
	return deleted;
}
