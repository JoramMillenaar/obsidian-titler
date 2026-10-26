export type FileProgress = {file: string; loaded: number; total: number};

/**
 * Overall download progress over a model's files. transformers.js reports each file on its own,
 * and the second weight file only appears once it starts, so a plain per-file percentage would
 * jump back to 0. Progress is measured against the expected total instead, and never goes back.
 */
export class DownloadProgress {
	private readonly files = new Map<string, {loaded: number; total: number}>();
	private percent = 0;

	constructor(private readonly expectedBytes: number, private readonly minFileBytes: number) {
	}

	/** Records one progress event; returns overall progress (0–100), or null for files too small to count. */
	update({file, loaded, total}: FileProgress): number | null {
		if (total < this.minFileBytes) return null;
		this.files.set(file, {loaded: Math.min(loaded, total), total});

		let loadedSum = 0;
		let totalSum = 0;
		for (const entry of this.files.values()) {
			loadedSum += entry.loaded;
			totalSum += entry.total;
		}
		const denominator = Math.max(totalSum, this.expectedBytes);
		this.percent = Math.max(this.percent, Math.min(100, (loadedSum / denominator) * 100));
		return this.percent;
	}

	/** Bytes counted so far. */
	loadedBytes(): number {
		let sum = 0;
		for (const entry of this.files.values()) sum += entry.loaded;
		return sum;
	}
}
