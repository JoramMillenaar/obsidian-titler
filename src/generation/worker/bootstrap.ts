import { WorkerRequest, WorkerResponse } from "../protocol";
import { createHandlers } from "./handlers";
import { transformersBackend } from "./model";

/**
 * Entry point bundled into the model worker (see esbuild.config.mjs). One worker serves one model;
 * the host terminates it to unload the model, which is the only way to hand its memory back.
 */

function post(message: WorkerResponse): void {
	(self as unknown as {postMessage(message: WorkerResponse): void}).postMessage(message);
}

const handle = createHandlers(transformersBackend, post);

self.addEventListener("message", (event: MessageEvent<WorkerRequest>) => {
	void handle(event.data);
});
