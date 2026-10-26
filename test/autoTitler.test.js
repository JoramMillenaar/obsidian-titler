const test = require("node:test");
const assert = require("node:assert");

/** Manual clock for the typing pause. */
function makeClock() {
	let now = 0;
	let seq = 0;
	const timers = new Map();
	const flush = () => new Promise((resolve) => setImmediate(resolve));
	return {
		setTimeout(fn, ms) {
			const id = ++seq;
			timers.set(id, {at: now + (ms || 0), fn});
			return id;
		},
		clearTimeout(id) {
			timers.delete(id);
		},
		async advance(ms) {
			const target = now + ms;
			for (;;) {
				let due = null;
				for (const [id, timer] of timers) {
					if (timer.at <= target && (due === null || timer.at < due.timer.at)) due = {id, timer};
				}
				if (!due) break;
				timers.delete(due.id);
				now = due.timer.at;
				due.timer.fn();
				await flush();
			}
			now = target;
			await flush();
		},
		flush,
	};
}

const clock = makeClock();
global.window = {setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout};

const {AutoTitler} = require("../dist/titling/autoTitler.js");
const {makeUntitledMatcher} = require("../dist/core/rules/untitled.js");

const PAUSE = 5000;
const words = (count) => Array.from({length: count}, (_, i) => `word${i}`).join(" ");
const FORMAT = {casing: "sentence", length: "medium", style: "topic"};

/** A vault in memory, whose renames report back to the titler the way vault events do. */
function setup({titles = ["Sourdough starter care", "Feeding schedule"], suggest, focused = () => false, available = true, taken = []} = {}) {
	const files = new Map();
	const notified = [];
	const notes = {
		read: async (path) => files.get(path)?.markdown ?? null,
		exists: (path) => files.has(path),
		takenNames: () => new Set([...taken, ...[...files.keys()].map((path) => path.replace(/\.md$/, "").toLowerCase())]),
		isLinkTaken: () => false,
		frontmatterKeys: (path) => files.get(path)?.frontmatter ?? [],
		rename: async (path, basename) => {
			const to = `${basename}.md`;
			files.set(to, files.get(path));
			files.delete(path);
			titler.renamed(path, to);
			return to;
		},
	};
	const titler = new AutoTitler({
		notes,
		suggest: suggest ?? (async () => titles),
		settings: () => ({autoTitle: true, minWords: 30, format: FORMAT}),
		isModelAvailable: async () => available,
		isUntitled: makeUntitledMatcher(["Untitled"]),
		isExcludedPath: (path) => path.startsWith("Templates/"),
		isTitleFocused: (path) => focused(path),
		countWords: (markdown) => (markdown.match(/\S+/g) ?? []).length,
		notifyRenamed: (from, to, undo) => notified.push({from, to, undo}),
		pauseMs: PAUSE,
	});
	const write = (path, markdown, frontmatter) => files.set(path, {markdown, frontmatter});
	return {titler, files, notified, write};
}

test("an Untitled note is named once typing pauses with enough words", async () => {
	const {titler, files, notified, write} = setup();
	write("Untitled.md", "");
	await titler.seen("Untitled.md");

	write("Untitled.md", words(40));
	titler.edited("Untitled.md");
	await clock.advance(PAUSE - 1);
	assert.ok(files.has("Untitled.md"), "still typing");

	await clock.advance(1);
	assert.ok(files.has("Sourdough starter care.md"));
	assert.deepStrictEqual(notified.map(({from, to}) => [from, to]), [["Untitled.md", "Sourdough starter care.md"]]);
	titler.dispose();
});

test("too few words leaves it Untitled", async () => {
	const {titler, files, write} = setup();
	write("Untitled.md", "");
	await titler.seen("Untitled.md");
	write("Untitled.md", words(10));
	titler.edited("Untitled.md");
	await clock.advance(PAUSE);
	assert.ok(files.has("Untitled.md"));
	titler.dispose();
});

test("leaving the note names it without waiting for the pause", async () => {
	const {titler, files, write} = setup();
	write("Untitled 2.md", "");
	await titler.seen("Untitled 2.md");
	write("Untitled 2.md", words(40));
	titler.edited("Untitled 2.md");
	titler.left("Untitled 2.md");
	await clock.flush();
	await clock.flush();
	assert.ok(files.has("Sourdough starter care.md"));
	titler.dispose();
});

test("text the note already had when opened doesn't count as typed", async () => {
	const {titler, files, write} = setup();
	write("Untitled.md", words(100));
	await titler.seen("Untitled.md");

	write("Untitled.md", words(110));
	titler.edited("Untitled.md");
	await clock.advance(PAUSE);
	assert.ok(files.has("Untitled.md"), "10 new words is not enough");

	write("Untitled.md", words(140));
	titler.edited("Untitled.md");
	await clock.advance(PAUSE);
	assert.ok(files.has("Sourdough starter care.md"));
	titler.dispose();
});

test("editing the title postpones naming until the user is done with it", async () => {
	let focused = true;
	const {titler, files, write} = setup({focused: () => focused});
	write("Untitled.md", "");
	await titler.seen("Untitled.md");
	write("Untitled.md", words(40));
	titler.edited("Untitled.md");
	await clock.advance(PAUSE);
	assert.ok(files.has("Untitled.md"));

	focused = false;
	titler.titleBlurred("Untitled.md");
	await clock.advance(PAUSE);
	assert.ok(files.has("Sourdough starter care.md"));
	titler.dispose();
});

test("a name already used in the folder makes way for the next suggestion", async () => {
	const {titler, files, write} = setup({taken: ["sourdough starter care"]});
	write("Untitled.md", "");
	await titler.seen("Untitled.md");
	write("Untitled.md", words(40));
	titler.edited("Untitled.md");
	await clock.advance(PAUSE);
	assert.ok(files.has("Feeding schedule.md"));
	titler.dispose();
});

test("a note the user renames while the model thinks keeps the user's name", async () => {
	let finish;
	const {titler, files, write} = setup({suggest: () => new Promise((resolve) => (finish = resolve))});
	write("Untitled.md", "");
	await titler.seen("Untitled.md");
	write("Untitled.md", words(40));
	titler.edited("Untitled.md");
	await clock.advance(PAUSE);

	files.set("Mine.md", files.get("Untitled.md"));
	files.delete("Untitled.md");
	titler.renamed("Untitled.md", "Mine.md");
	finish(["Sourdough starter care"]);
	await clock.flush();
	await clock.flush();
	assert.deepStrictEqual([...files.keys()], ["Mine.md"]);
	titler.dispose();
});

test("undo restores the name, and the note is then left alone", async () => {
	const {titler, files, notified, write} = setup();
	write("Untitled.md", "");
	await titler.seen("Untitled.md");
	write("Untitled.md", words(40));
	titler.edited("Untitled.md");
	await clock.advance(PAUSE);
	assert.ok(files.has("Sourdough starter care.md"));

	await notified[0].undo();
	assert.ok(files.has("Untitled.md"));

	write("Untitled.md", words(80));
	titler.edited("Untitled.md");
	await clock.advance(PAUSE);
	assert.ok(files.has("Untitled.md"), "not renamed again after undo");
	titler.dispose();
});

test("named notes, excluded folders, Excalidraw drawings and an unavailable model are left alone", async () => {
	for (const [path, frontmatter, options] of [
		["My note.md", [], {}],
		["Templates/Untitled.md", [], {}],
		["Untitled.md", ["excalidraw-plugin"], {}],
		["Untitled.md", [], {available: false}],
	]) {
		const {titler, files, write} = setup(options);
		write(path, "", frontmatter);
		await titler.seen(path);
		write(path, words(40), frontmatter);
		titler.edited(path);
		await clock.advance(PAUSE);
		assert.ok(files.has(path), path);
		titler.dispose();
	}
});

test("naming a note on request ignores its name and length", async () => {
	const {titler, files, write} = setup();
	write("Meeting.md", "short");
	assert.strictEqual(await titler.nameNow("Meeting.md"), "Sourdough starter care.md");
	assert.ok(files.has("Sourdough starter care.md"));
	titler.dispose();
});
