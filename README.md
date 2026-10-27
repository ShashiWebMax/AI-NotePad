# SketchNotes

An infinite whiteboard built for client video calls. Paste screenshots of an app, mark them up, sketch
ideas and take notes. An AI assistant can edit the board, write up notes or generate mockups. It works
with Claude, ChatGPT, Gemini or any OpenRouter model, using your own API keys, and you can also
give it prompts by voice.

There is **no backend**:
- The app is a set of static files that runs in your browser.
- Boards are saved straight into a folder on your disk.
- AI calls go directly from your browser to the provider you choose.

---

## Contents

- [Features](#features)
- [Requirements](#requirements)
- [Quick start](#quick-start)
- [Other ways to run it](#other-ways-to-run-it)
- [First-time setup](#first-time-setup)
- [Using it on a client call](#using-it-on-a-client-call)
- [Drawing](#drawing)
- [AI assistant](#ai-assistant)
- [Voice prompts](#voice-prompts)
- [Use with Claude Code](#use-with-claude-code)
- [Keyboard shortcuts](#keyboard-shortcuts)
- [Where your files go](#where-your-files-go)
- [Privacy and security](#privacy-and-security)
- [Troubleshooting](#troubleshooting)
- [For developers](#for-developers)

---

## Features

- **Infinite canvas.** Zoom and pan freely; new boards start centred.
- **Images.** Paste them (⌘V / Ctrl+V) or drag them in from your desktop or browser.
- **Drawing tools.** Pens, a red marker, a pencil, a highlighter, highlight boxes, text, sticky
  notes, arrows and connectors that stay attached, and the standard diagram shapes (rectangle,
  ellipse, diamond, line, frame).
- **✨ Auto-shapes (toggle).** Rough circles, boxes, diamonds, triangles, lines and arrows drawn
  with the pen turn into clean shapes.
- **AI on the board.** Select something, type or say what you want, and the AI:
  - highlights areas;
  - adds sticky notes, arrows and diagrams;
  - restyles or removes elements;
  - writes notes such as task lists, summaries or follow-up emails.
- **AI images.** Generates a mockup, for example "this screen with the requested changes", and
  places it next to the original.
- **Voice mode.** Click 🎙️ or press Ctrl+Shift+Space, speak, and the request is sent when you stop
  talking.
- **Projects and boards.** You get one folder per client or app, and one board per call. Everything
  saves automatically.
- **Standard file format.** Boards are Excalidraw files, so they also open at
  [excalidraw.com](https://excalidraw.com).

---

## Requirements

| What | Version / notes |
|---|---|
| Node.js | 20 or newer (includes `npm`). Download from [nodejs.org](https://nodejs.org). |
| Browser | **Chrome, Edge, Brave or Arc** for saving to a folder on your disk. Safari and Firefox work too, but keep boards inside the browser instead of a visible folder. |
| API key (optional) | At least one of Anthropic (Claude), OpenAI, Google Gemini or OpenRouter, for the AI features. Drawing works without any key. |
| Docker (optional) | Only needed if you prefer running it in a container instead of Node. |

To check your Node version:

```bash
node -v
```

---

## Quick start

1. Open a terminal in the project folder.

   ```bash
   cd "/path/to/Note app"
   ```

2. Install dependencies. This is only needed once, and again after updating the code.

   ```bash
   npm install
   ```

3. Build and start the app.

   ```bash
   npm start
   ```

4. Open **http://localhost:5173** in Chrome, Edge, Brave or Arc.

To stop the app, press **Ctrl+C** in the terminal. Your boards are already saved.

---

## Other ways to run it

### Development mode (hot reload)

Use this when you are changing the code. The page updates as you save files.

```bash
npm run dev
```

Then open http://localhost:5173.

### Docker

This serves the same static build with nginx on **http://localhost:8080**. Docker Desktop must be
running.

```bash
docker compose up -d --build
```

To stop it:

```bash
docker compose down
```

### GitHub Pages

The repo includes a workflow, [.github/workflows/deploy-pages.yml](.github/workflows/deploy-pages.yml),
that builds the app and publishes it on every push to `main`. The site appears at
`https://<username>.github.io/<repo>/`.

One-time setup:

1. Create a repository on GitHub. On a free plan it must be **public** to use Pages. The code
   contains no keys or secrets.
2. Push this project to its `main` branch.

   ```bash
   git init -b main
   ```

   ```bash
   git add . && git commit -m "Initial commit"
   ```

   ```bash
   git remote add origin https://github.com/<username>/<repo>.git
   ```

   ```bash
   git push -u origin main
   ```

3. On GitHub, open the repo's **Settings → Pages** and set **Source** to **GitHub Actions**.
4. Open the **Actions** tab. If the first run failed because Pages wasn't enabled yet, re-run
   **Deploy to GitHub Pages**. When it finishes, the site link appears in the run summary.

After that, every push to `main` redeploys automatically. The workflow reads the sub-path
(`/<repo>/`) from GitHub, so renaming the repo or adding a custom domain needs no code change.

**How it works on Pages:**
- **Folder saving and the microphone work**, because GitHub Pages serves over HTTPS.
- **API keys are never in the repo.** Each person who opens the site pastes their own keys in
  Settings, and they stay in that browser.
- **Boards are separate.** Boards and keys saved on the hosted site are kept apart from the ones
  on `localhost`. To use an existing projects folder, open it on the hosted site too.
- **Your sites share browser storage.** All project sites on one account share the origin
  `<username>.github.io`, and therefore its browser storage. Any other Pages site you publish on
  that account could read keys saved by SketchNotes. To avoid this:
  - give SketchNotes its own origin with a custom domain (repo **Settings → Pages → Custom
    domain**), or
  - host `dist/` on Netlify, Vercel or Cloudflare Pages instead.

  Either way, use keys with spending limits.

To build for a sub-path yourself, for example to test locally:

```bash
BASE_PATH=/sketchnotes/ npm run build
```

### Any static web server

`npm run build` writes the finished app to `dist/`. Any static file server can serve that folder.
Set `BASE_PATH` when it isn't served from the root of the domain. Use HTTPS (or `localhost`) so
folder saving and the microphone work.

```bash
npm run build
```

```bash
npx vite preview --port 5173
```

### Using a different port

`npm start` uses port 5173 and stops if that port is busy. To pick another port:

```bash
npx vite preview --port 5180
```

---

## First-time setup

1. **Choose where boards are saved.**
   - Click **Open projects folder…** in the left sidebar and pick or create a folder, for example
     `~/Documents/SketchNotes`, then allow access when the browser asks.
   - After a browser restart, click **Reconnect folder** once.
   - In Safari or Firefox, click **Use browser storage instead**.
2. **Create a project** (for example the client's or app's name). It comes with a first board. Use
   **＋** next to a project to add more boards, and double-click a board's name to rename it.
3. **Add an AI key (optional).**
   - Click **⚙︎ Settings** at the bottom left, or **AI & voice settings** in the ☰ menu, and paste
     one or more keys. Each field has a *get key ↗* link.
   - Changes save automatically. The first key you add is selected as the provider.
   - Under **Board AI** and **Image generation**, pick a provider and model. **Load list** fetches
     the models available on your account.

| Provider | Get a key | Used for |
|---|---|---|
| Anthropic (Claude) | https://console.anthropic.com/settings/keys | Board AI |
| OpenAI | https://platform.openai.com/api-keys | Board AI, images, voice transcription |
| Google Gemini | https://aistudio.google.com/apikey | Board AI, images (paid tier), voice transcription |
| OpenRouter | https://openrouter.ai/settings/keys | Board AI, images (many models with one key) |

### Default models

| Setting | Anthropic | OpenAI | Gemini | OpenRouter |
|---|---|---|---|---|
| Board AI | `claude-opus-5-5` | `gpt-5` | `gemini-3.5-flash` | `anthropic/claude-opus-4.5` |
| Image generation | — | `gpt-image-1` | `gemini-3-pro-image` | `google/gemini-3.1-flash-image` |
| Voice transcription | — | `gpt-4o-transcribe` | `gemini-flash-latest` | — |

You can type any other model name into the Model field.

**A cheap, tested setup:**
- **Board AI:** a free Gemini key with `gemini-3.5-flash`.
- **Image generation:** an OpenRouter key with `google/gemini-3.1-flash-image`, at a few cents
  per image.

---

## Using it on a client call

1. Create a board for the call, for example "Call 27 Oct".
2. Paste the screenshots the client is talking about (⌘V / Ctrl+V), or drag them in.
3. Mark them up while they talk. Use the **highlighter** or **highlight box** for areas to change,
   the **red marker** to circle things, and **text** or sticky notes for comments.
4. Ask the AI to tidy up or extend the notes, for example:
   - "Highlight everything the client asked to change and add a sticky note for each."
   - "Summarise all requested changes as a prioritised task list."
   - "Generate a mockup of this screen with the darker header and bigger checkout button."
5. Save the notes. Use **Save .md** on an AI answer to write it to the project's `exports/` folder,
   or **Put on board** to keep it next to the screenshots.

---

## Drawing

All of [Excalidraw](https://github.com/excalidraw/excalidraw)'s tools are available in the top
toolbar:
- shapes, arrows, lines, freehand, text, images, frames and the eraser;
- undo/redo, dark mode, and export to PNG or SVG.

The **bottom bar** adds quick presets:

| Preset | What it's for |
|---|---|
| Pen | Normal ink |
| Red marker | Circling or underlining things to change |
| Pencil | Thin, light sketching |
| Highlighter | See-through strokes over screenshots. Your normal pen style comes back when you switch tools. |
| Highlight box | A see-through filled rectangle over an area |
| Arrow | Connector that sticks to shapes and images |
| Text | Click anywhere and type |

### ✨ Auto-shapes

Turn this on in the bottom bar. When you draw with a pen:
- a rough **circle, ellipse, rectangle, diamond, triangle, line or arrow** becomes a clean shape;
- lines and arrows that start or end on a shape or image get **connected** to it;
- a small **"V"** drawn at the end of a line, straight after drawing it, turns the line into an
  arrow.

**⌘Z / Ctrl+Z** brings back your original stroke. Highlighter strokes are never converted.

---

## AI assistant

Open the panel with **✨ AI** at the top right.

**What the AI sees:**
- an image of your **selection**, or of what's on screen when nothing is selected;
- a list of the elements on the board and all of its text.

Switch the scope dropdown to **Whole board** for summaries of everything.

### Modes

- **Board.** The AI edits the board:
  - adds highlights, sticky notes, arrows, shapes, text and diagrams;
  - moves, recolours, relabels or deletes things;
  - writes notes, which have **Copy**, **Put on board** and **Save .md** buttons.

  If you ask for a picture, it also calls the image model.
- **Image.** Generates an image from your prompt and the selection, and places it beside the
  selection. The image is saved in the project's `files/` folder.

Each AI change is a single undo step. Requests can be stopped with **Cancel**. They time out
after 3 minutes.

### Tips for models

- **Board AI.**
  - Claude Opus 5.5 is the strongest at reading screenshots and making tidy layouts.
  - Gemini Flash is the fastest and works on a free key.
  - Lower **Thinking effort** in Settings for quicker answers, or raise it for complex diagrams.
- **Images.**
  - Gemini "Nano Banana" models (`gemini-3-pro-image`, `gemini-3.1-flash-image`) are best at
    editing a screenshot while keeping its layout.
  - OpenAI `gpt-image-1` also works.
  - On OpenRouter, choose a model whose output includes images.

### Gemini free tier

- **What works:** Board AI with **Flash** models. The default is `gemini-3.5-flash`.
- **What doesn't:** Pro models and image generation; the free tier allows zero requests for these.
- **For images:** turn on billing for the key in Google AI Studio, or set Image generation to
  OpenRouter or OpenAI.
- **When a model is busy:** if the chosen Gemini model is overloaded or unavailable, the app tries
  other Flash models automatically and says which one answered.

---

## Voice prompts

1. Press **🎙️** (top right, or **Speak** in the AI panel), or press **Ctrl+Shift+Space**.
2. Allow the microphone the first time.
3. Speak your request, then pause. The text is sent when you stop talking. You can turn this off in
   Settings to edit the text first.

Saying "generate an image of…" switches straight to image mode. **Esc** cancels.

Voice engines (Settings → Voice prompts):

| Engine | Notes |
|---|---|
| Browser | Free, with live captions. Chrome sends the audio to Google for recognition. Set the language, e.g. `en-US` or `en-GB`. |
| OpenAI transcription | Needs an OpenAI key. Very accurate (`gpt-4o-transcribe`). |
| Gemini transcription | Needs a Gemini key. |

---

## Use with Claude Code

A skill in [skills/sketchnotes](skills/sketchnotes) lets Claude Code read and draw on your boards.
It works from any project, in the Claude desktop app's Code tab or the `claude` terminal.

- **Draw editable diagrams.** For example: "Draw the architecture of this repo on a new SketchNotes
  board in Acme App". Claude writes real shapes and connected arrows, not a picture, so you can move and
  edit them in the app.
- **Read your markups.** For example: "Implement the changes I marked on the Call 27 Oct board". Claude
  reads the screenshots, highlights, red marks, sticky notes and arrows, looks at the board's preview,
  turns them into a list of changes, and can make them in your code.
- **Report back on the board.** Claude can add notes such as "✓ Done: header colour" next to the
  screenshot.

If the board is open, Claude's changes appear within about 2 seconds.

### Install the skill

This copies it to your personal skills folder, so it's available in every project:

```bash
mkdir -p ~/.claude/skills && cp -R skills/sketchnotes ~/.claude/skills/
```

Then tell Claude where your projects folder is. It defaults to `~/Documents/SketchNotes`:

```bash
node ~/.claude/skills/sketchnotes/scripts/sketchnotes.mjs set-folder "~/Documents/SketchNotes"
```

### Requirements

- **A real folder.** Boards must be saved in a projects folder opened with **Open projects folder…**.
  Claude can't reach boards kept in browser storage.
- **Node.js 18 or newer** for the skill's helper script. It has no other dependencies.
- **Claude Code.** Regular claude.ai chat can't see files on your computer.

The skill uses a helper script rather than editing board files directly, which keeps arrows attached
and ids stable. You can also run it yourself:

```bash
node ~/.claude/skills/sketchnotes/scripts/sketchnotes.mjs list
```

---

## Keyboard shortcuts

| Shortcut | Action |
|---|---|
| ⌘V / Ctrl+V | Paste an image or text onto the board |
| Ctrl+Shift+Space | Start or stop a voice prompt |
| Esc | Cancel voice recording |
| Enter / Shift+Enter | Send prompt / new line (AI panel) |
| ⌘Z / Ctrl+Z | Undo (including AI changes and auto-shapes) |
| Space + drag, or scroll | Pan the canvas |
| ⌘ / Ctrl + scroll, or pinch | Zoom |
| Shift+1 | Zoom to fit everything |
| V, R, D, O, A, L, P, T, E, H | Select, rectangle, diamond, ellipse, arrow, line, pen, text, eraser, hand |
| ? | Show all Excalidraw shortcuts |

---

## Where your files go

```
SketchNotes/                     <- the folder you picked
  Acme App/                      <- a project (one per client or app)
    Call 27 Oct 2026.excalidraw  <- a board
    Call 27 Oct 2026.preview.png <- picture of the whole board, updated after each change
    files/                       <- images used on the boards (pasted and AI-generated)
    exports/                     <- AI notes you saved (.md)
```

- **Saving.** Boards save automatically a moment after each change. The sidebar shows
  "Saved ✓".
- **Live reload.** If another program changes the open board's file (for example
  [Claude Code](#use-with-claude-code)), the board updates within about 2 seconds. The change is merged
  with yours, and ⌘Z or the undo button reverses it. New boards and projects appear in the sidebar by
  themselves.
- **Format.** Boards are standard Excalidraw JSON. To open one at excalidraw.com, use the menu →
  *Export* to get a single file with the images embedded.
- **Backups.** Back up or sync the folder like any other: Time Machine, iCloud Drive, Dropbox or
  git.
- **Browser storage mode** (Safari/Firefox). The same structure lives inside the browser, so
  clearing the site's data deletes it. Export important boards.

---

## Privacy and security

- **API keys** are stored only in this browser's localStorage. They are never written to your
  project folders, and each key is sent only to its own provider.
  - Anyone with access to your browser profile can read them.
  - Use keys with spending limits, and revoke any key you've shared.
- **What reaches the AI provider:** only what you send — the snapshot of the selection or screen,
  the board's text and your prompt.
- **Where to run it.** On `localhost`, keys and boards never leave your machine, except for AI
  requests. The Docker setup binds to `127.0.0.1` for this reason.
- **Hosting it is fine**, for example on [GitHub Pages](#github-pages): the hosted copy is still
  only static files, and nothing is sent to the host. Prefer an origin that serves nothing else,
  such as a custom domain, because any page on the same origin can read the saved keys.

---

## Troubleshooting

| Problem | Fix |
|---|---|
| No **Open projects folder…** button | Your browser doesn't support folder access. Use Chrome/Edge/Brave/Arc, or choose browser storage. |
| Boards gone after restarting the browser | Click **Reconnect folder** and allow access again. The files are still on disk. |
| `Port 5173 is in use` | Another copy is running. Close it, or use `npx vite preview --port 5180`. |
| "Add an API key" warning in the AI panel | Paste a key in **⚙︎ Settings**. |
| Gemini error mentioning `limit: 0` | That model isn't on the free tier. Use a Flash model for Board AI, and OpenRouter/OpenAI for images. |
| "Model not found" or "retired" | Click **Load list** next to the model in Settings and pick a current one. |
| AI is slow | Click **Cancel**, set **Thinking effort** to Low, or pick a faster model (e.g. `gemini-3.5-flash`). |
| Image mode fails with a Claude key only | Claude doesn't generate images. Add a Gemini (paid), OpenAI or OpenRouter key and select it under Image generation. |
| Voice doesn't start | Allow the microphone for `localhost` in the browser's site settings. In Safari/Firefox, switch the voice engine to OpenAI or Gemini. |
| `docker compose` fails to connect | Start Docker Desktop first. |

---

## For developers

### Scripts

| Command | What it does |
|---|---|
| `npm install` | Installs dependencies and copies Excalidraw's fonts into `public/fonts` |
| `npm run dev` | Dev server with hot reload on port 5173 |
| `npm run build` | Type-checks and builds the static app into `dist/`. Set `BASE_PATH=/sub-folder/` to serve it from a sub-path. |
| `npm start` | Builds, then serves `dist/` on port 5173 |
| `npm run typecheck` | Type-checks only |

### Tech stack

- **App:** Vite 6, React 18 and TypeScript.
- **Canvas:** [Excalidraw](https://github.com/excalidraw/excalidraw) 0.18 (MIT licence).
- **Storage:** the File System Access API, with Origin Private File System (OPFS) as the fallback
  for browser storage.
- **AI:** the official Anthropic SDK for Claude, and direct `fetch` calls to the OpenAI, Gemini and
  OpenRouter APIs.
- **Voice:** the Web Speech API, or MediaRecorder with silence detection plus a transcription API.

### Project layout

```
index.html                 entry page
scripts/copy-fonts.mjs     copies Excalidraw fonts on install
src/
  App.tsx                  layout, board loading/saving, presets
  settings.ts              settings, default models, model migrations
  scene.ts                 element helpers (boxes, arrow binding)
  storage/fs.ts            folder access, projects, boards, images, exports, previews
  storage/sync.ts          merges outside edits to the open board (live reload)
  recognize/geometry.ts    shape recognizer (pure geometry)
  recognize/recognition.ts replaces strokes with clean shapes on the canvas
  ai/providers.ts          Claude / OpenAI / Gemini / OpenRouter calls (chat, images, model lists, speech)
  ai/agent.ts              board snapshot -> prompt -> JSON edits -> applied to the canvas
  voice/voice.ts           voice capture + silence detection
  components/              sidebar, AI panel, settings dialog, pen bar
  styles.css               theme and layout
Dockerfile, docker-compose.yml   static build served by nginx on 127.0.0.1:8080
.github/workflows/deploy-pages.yml  builds and publishes to GitHub Pages on push to main
skills/sketchnotes/              Claude Code skill: SKILL.md + helper script (scripts/sketchnotes.mjs)
```

### How the AI edits the board

1. The app takes a PNG snapshot of the selection or viewport, and lists the elements in it using
   the snapshot's pixel coordinates.
2. The model replies with JSON operations: `add`, `update`, `delete`, `notes_markdown` and
   `generate_image`.
3. `ai/agent.ts` converts those back to canvas coordinates and applies them as one undoable step.
   Arrows are bound to the shapes they connect.
