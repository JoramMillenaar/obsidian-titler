/**
 * The bundled model worker's source, inlined here by esbuild.config.mjs. Read lazily: outside a
 * build (tests) the placeholder is not defined.
 */
export function modelWorkerScript(): string {
	return __WORKER_CONTENTS_PLACEHOLDER__;
}

/** Starts a Worker running `script`. */
export function startWorker(script: string): Worker {
	const url = URL.createObjectURL(new Blob([script], {type: "application/javascript"}));
	try {
		return new Worker(url);
	} finally {
		URL.revokeObjectURL(url);
	}
}
