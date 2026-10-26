import { Lane } from "../protocol";

export class CancelledError extends Error {
	constructor() {
		super("The request was cancelled.");
		this.name = "CancelledError";
	}
}

type Task = {
	id: number;
	run: () => Promise<unknown>;
	resolve: (value: unknown) => void;
	reject: (error: Error) => void;
};

/**
 * Runs one generation at a time, taking interactive requests before background ones. A request
 * still waiting can be cancelled here; a running one has to be interrupted by whoever runs it.
 */
export class LaneQueue {
	private readonly lanes: Record<Lane, Task[]> = {interactive: [], background: []};
	private running: {id: number; done: Promise<void>} | null = null;
	private closed = false;

	run<T>(id: number, lane: Lane, work: () => Promise<T>): Promise<T> {
		if (this.closed) return Promise.reject(new Error("The model worker is shutting down."));

		return new Promise<T>((resolve, reject) => {
			this.lanes[lane].push({id, run: work, resolve: resolve as (value: unknown) => void, reject});
			if (!this.running) void this.drain();
		});
	}

	/** Removes a waiting request, rejecting it with {@link CancelledError}. False if it isn't waiting (running or unknown). */
	cancel(id: number): boolean {
		for (const lane of Object.values(this.lanes)) {
			const at = lane.findIndex((task) => task.id === id);
			if (at < 0) continue;
			const [task] = lane.splice(at, 1);
			task?.reject(new CancelledError());
			return true;
		}
		return false;
	}

	isRunning(id: number): boolean {
		return this.running?.id === id;
	}

	/** Rejects everything still waiting and resolves once the running request has settled. */
	async close(): Promise<void> {
		this.closed = true;
		for (const task of [...this.lanes.interactive.splice(0), ...this.lanes.background.splice(0)]) {
			task.reject(new Error("The model worker is shutting down."));
		}
		await this.running?.done;
	}

	private async drain(): Promise<void> {
		for (let task = this.next(); task; task = this.next()) {
			let finish!: () => void;
			this.running = {id: task.id, done: new Promise<void>((resolve) => (finish = resolve))};
			try {
				task.resolve(await task.run());
			} catch (error) {
				task.reject(error instanceof Error ? error : new Error(String(error)));
			} finally {
				finish();
			}
		}
		this.running = null;
	}

	private next(): Task | undefined {
		return this.lanes.interactive.shift() ?? this.lanes.background.shift();
	}
}
