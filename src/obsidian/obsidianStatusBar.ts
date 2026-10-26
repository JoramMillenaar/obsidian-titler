import { Plugin } from "obsidian";
import { StatusReporter } from "../ports";

export class ObsidianStatusBar implements StatusReporter {
	private statusBarItem: HTMLElement;
	private clearTimeoutId: number | null = null;

	constructor(plugin: Plugin) {
		this.statusBarItem = plugin.addStatusBarItem();
		this.statusBarItem.addClass("titler-status");
		this.clear(); // start blank
	}

	update(text: string, timeout: number | null = 3000): void {
		this.statusBarItem.setText(`[Titler]: ${text}`);

		if (this.clearTimeoutId !== null) {
			window.clearTimeout(this.clearTimeoutId);
			this.clearTimeoutId = null;
		}

		if (timeout !== null) {
			this.clearTimeoutId = window.setTimeout(() => {
				this.clear();
			}, timeout);
		}
	}

	clear(): void {
		if (this.clearTimeoutId !== null) {
			window.clearTimeout(this.clearTimeoutId);
			this.clearTimeoutId = null;
		}
		this.statusBarItem.setText("");
	}
}
