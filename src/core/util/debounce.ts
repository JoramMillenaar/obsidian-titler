export class KeyedDebouncer<K> {
	private pendingTimers = new Map<K, {timerId: number; callback: () => void | Promise<void>}>();

	constructor(private delayMs: number) {
	}

	schedule(key: K, callback: () => void | Promise<void>): void {
		const existing = this.pendingTimers.get(key);
		if (existing) window.clearTimeout(existing.timerId);

		const timerId = window.setTimeout(() => {
			this.pendingTimers.delete(key);
			void Promise.resolve(callback());
		}, this.delayMs);

		this.pendingTimers.set(key, {timerId, callback});
	}

	/** Runs `key`'s pending callback now instead of when its delay ends. False if none was pending. */
	flush(key: K): boolean {
		const pending = this.pendingTimers.get(key);
		if (!pending) return false;
		window.clearTimeout(pending.timerId);
		this.pendingTimers.delete(key);
		void Promise.resolve(pending.callback());
		return true;
	}

	isPending(key: K): boolean {
		return this.pendingTimers.has(key);
	}

	cancel(key?: K): void {
		if (key != null) {
			const pending = this.pendingTimers.get(key);
			if (pending) {
				window.clearTimeout(pending.timerId);
				this.pendingTimers.delete(key);
			}
		} else {
			this.pendingTimers.forEach((pending) => window.clearTimeout(pending.timerId));
			this.pendingTimers.clear();
		}
	}
}
