# Titler

Titles for your Obsidian notes, written by a small AI that runs entirely on your device.

- **Suggestions when you select a title.** Click a note's title (or run **Suggest titles for this
  note**) and three suggestions appear under it, next to one taken from the note's first heading or
  line. Pick one to rename the note; links to it are updated as with any rename. Select
  **Generate more titles** for different ones. Use the arrow keys to move through them, Enter to
  rename the note, or Tab to put a suggestion in the title and edit it first. Changed your mind?
  Press Cmd+Z (Ctrl+Z) right after picking one to get the old name back.
- **Suggestions are kept.** The titles the AI came up with for a note, including the ones an
  automatic name passed over, show up again instantly the next time you open its suggestions,
  until the note has about doubled in length.
- **Untitled notes name themselves.** Once you've written a few sentences in an "Untitled" note,
  it gets a title when you pause typing or switch to another note. Each rename can be undone from
  the notice that announces it, and a note you undo is left alone after that.
- **In your note's language.** Titles come out in the language the note is written in.
- **See when the AI is in memory.** A small sparkles icon shimmers in the status bar while the
  model is loaded, and a ring fills up in its place while it loads. Select it to see which model
  is running and where and how long until it unloads by itself, or to unload it and free its
  memory right away.

## Settings

- **Name untitled notes automatically**: on by default.
- **Capitalization**: Sentence case, Title Case or lowercase.
- **Length**: short (2–4 words), medium (4–8) or descriptive (up to 12).
- **Style**: a topic ("Sourdough starter care"), a claim ("Starters need daily feeding at room
  temperature") or a question ("How often should I feed a starter").

Under **Advanced** you can turn the AI off on one device, choose how long the model stays in
memory after use on that device, change how much you need to have written before a note is
named, and delete the downloaded model.

## Privacy and network use

Your notes never leave your device: titles are generated locally, with no account, API key or
external service.

The plugin uses the network once, to download what it runs:

- the AI model ([Qwen3.5 2B](https://huggingface.co/onnx-community/Qwen3.5-2B-ONNX-OPT), about
  1.4 GB) from **huggingface.co**, which starts when you enable the plugin (you can put it off from
  the notice and start it later from the settings);
- the ONNX Runtime files that run it, from **cdn.jsdelivr.net**.

Both are stored in Obsidian's own storage on that device, shared by all your vaults, and work
offline after that. There is no telemetry. **Report a bug** in the settings opens a GitHub issue in
your browser, which you can read and edit before sending; it never includes your notes.

## Requirements

- Obsidian 1.13 or later, on desktop. The model is too large for phones and tablets.
- About 1.5 GB of disk space for the model, and as much memory while it's loaded. It unloads
  after 10 minutes without use (adjustable under **Advanced**) and reloads in a few seconds when
  needed.
- A GPU with WebGPU support makes a title take about a second. Without one, the plugin runs on the
  CPU, which works but is noticeably slower.

## Development

```bash
npm install
npm run dev     # rebuilds main.js on change
npm test        # unit tests (node:test)
npm run lint
npm run build   # production build
```

Copy or symlink `main.js`, `manifest.json` and `styles.css` into
`<vault>/.obsidian/plugins/titler/` and enable the plugin. The model runs in a Web Worker
(`src/generation/worker`), bundled into `main.js` by `esbuild.config.mjs`.

## License

The model, Qwen3.5 2B, is licensed under Apache 2.0.
