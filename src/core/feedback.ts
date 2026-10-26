/** What a bug report says about the setup. Never note contents or names. */
export type Environment = {
	pluginVersion: string;
	obsidianVersion: string;
	platform: string;
	model: string;
	engine: string;
	settings: string;
};

export type FeedbackKind = "bug" | "idea";

/** A new GitHub issue, prefilled; the user sees and edits everything before anything is sent. */
export function feedbackIssueUrl(repoUrl: string, kind: FeedbackKind, environment: Environment): string {
	const title = kind === "bug" ? "[Bug] " : "[Idea] ";
	const body = kind === "bug"
		? [
			"**What happened?**",
			"",
			"",
			"**What did you expect?**",
			"",
			"",
			"**Environment**",
			...Object.entries(environment).map(([key, value]) => `- ${key}: ${value}`),
		].join("\n")
		: "**What would you like Titler to do?**\n\n";
	return `${repoUrl}/issues/new?title=${encodeURIComponent(title)}&body=${encodeURIComponent(body)}`;
}
