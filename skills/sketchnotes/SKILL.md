---
name: sketchnotes
description: Read and draw on the user's SketchNotes whiteboards (local Excalidraw boards). Use when the user mentions SketchNotes, a board or whiteboard in their projects folder, asks for an editable diagram (architecture, flow, sequence, mind map) to be drawn on a board, or asks to read, summarise or implement changes they marked up on a screenshot in SketchNotes.
---

# SketchNotes

SketchNotes is the user's whiteboard app. Each board is an Excalidraw JSON file in a local projects folder:

```
<projects folder>/
  <Project>/
    <Board>.excalidraw        the board (shapes, arrows, text, highlights, image placements)
    <Board>.preview.png       picture of the whole board, written by the app ~3 s after each change
    files/<id>.png|jpg        screenshots and other images used on the boards
    exports/*.md              notes the user saved
```

If the board is open in the app, it picks up file changes within about 2 seconds and merges them with the
user's own edits. The user can undo Claude's change with ⌘Z. If the app is closed, the changes appear next time
the board is opened.

Always go through the helper script. It keeps arrows attached, labels inside shapes and ids stable.
Never hand-edit `.excalidraw` files or files in `files/`.

```bash
S=~/.claude/skills/sketchnotes/scripts/sketchnotes.mjs
node $S list                      # projects and boards (run this first)
node $S read "Project/Board"      # what's on a board
```

## Setup (first use)

`node $S where` prints the projects folder. It defaults to `~/Documents/SketchNotes`.

If no folder is set up yet, ask the user which folder they opened in SketchNotes with **Open projects folder…**,
then run `node $S set-folder "<path>"`.

Boards kept in **browser storage** (Safari/Firefox, or "Use browser storage instead") are not on disk. Claude
cannot reach those. Tell the user to switch to a real folder in the sidebar.

## Reading markups on a screenshot

Use this for requests like "implement the changes I marked on the 27 Oct board" or "what did the client ask for?".

1. `node $S read "Project/Board"`. The output lists:
   - each screenshot with its file path and pixel size;
   - every markup (highlight boxes, highlighter strokes, red marker strokes, outline shapes) and which
     screenshot it sits on, as a percentage of the image and in image pixels;
   - sticky notes and text;
   - arrows, with what they point from and to.
2. Look at the board with the Read tool:
   - the preview PNG, to see markups in place and read handwriting;
   - the original screenshot in `files/`, for fine detail.

   If `read` says the preview is older than the board, ask the user to open the board in SketchNotes so it refreshes.
3. Turn the markups into a list of concrete changes. Each item should say which screen and which area
   ("Image 1, top bar, 0–100% across, 0–8% down"), and what was asked:
   - the text of the nearest sticky note;
   - the note an arrow comes from;
   - the handwriting next to the mark.

   Red marks and highlights with no note usually mean "change this". Say what you assume.
4. When asked to implement the changes, find the matching code in the current project and make them. Then
   report each markup as done or not done.

   If the user wants progress shown on the board, add a green sticky note next to finished items with `draw`.
   Use `relativeTo` the screenshot's id, and phrase it like "✓ Done: header colour". Leave the user's
   markups in place.

## Drawing diagrams

Write a spec to a temp file (or pipe it in with `-`), then run `node $S draw "Project/Board" spec.json`.
To start a fresh board, run `node $S new "Project/Board"` first.

```json
{
  "title": "Checkout flow",
  "direction": "down",
  "at": "right",
  "nodes": [
    { "id": "cart", "label": "Cart page", "shape": "rectangle", "color": "blue" },
    { "id": "auth", "label": "Logged in?", "shape": "diamond", "color": "yellow" },
    { "id": "login", "label": "Login", "shape": "ellipse" },
    { "id": "pay", "label": "Stripe\ncheckout", "color": "green" },
    { "id": "n1", "label": "Client wants Apple Pay here", "shape": "sticky" }
  ],
  "edges": [
    { "from": "cart", "to": "auth" },
    { "from": "auth", "to": "pay", "label": "yes" },
    { "from": "auth", "to": "login", "label": "no", "style": "dashed" },
    { "from": "n1", "to": "pay", "color": "red" }
  ]
}
```

**Nodes**
- `shape`: `rectangle` (default), `ellipse`, `diamond`, `text`, `sticky` (note card), `highlight`
  (see-through box) or `frame`.
- `label`: may contain `\n`. Sizes are worked out from the label.
- `color`: blue, green, red, yellow, orange, purple, pink, teal or gray, or a `#hex` value.
- Other optional fields: `fill` (a colour name, for a different fill), `style` (`dashed` or `dotted`), `fontSize`, `w`, `h`.

**Layout**
- When no node has `x`/`y`, the script lays the nodes out in layers following the edges:
  - `direction` is `down` (default) or `right`;
  - `at` places the block: `"right"` of existing content (default), `"below"`, `{ "x": 0, "y": 0 }`,
    or `{ "near": "<elementId>", "side": "right" | "below" }`.
- When nodes have `x`/`y`, they are placed exactly there in scene units. Add `"relativeTo": "<elementId>"`
  to measure from that element's top-left corner. Use this for annotating a screenshot: `read` gives each
  image's position and size on the board.

**Edges**
- `from` and `to` are node ids from this spec or ids already on the board.
- Optional fields: `label`, `color`, `style` (`dashed` or `dotted`), `arrow` (`end` (default), `both` or `none`).

**Ids** in the spec are kept as element ids when they're free, so later `edit` calls can use them.

Tips:
- Keep each diagram under about 25 nodes. Split bigger systems into several diagrams, using `at: "below"`.
- Use colour by meaning: blue for services or pages, green for data stores or success, yellow for decisions,
  red for problems.
- Don't stack new content on top of the user's work. The default `at: "right"` avoids that.
- Run `read` afterwards, look at the preview if the app is open, and fix any overlaps with `edit`.

## Editing what's there

`node $S edit "Project/Board" ops.json` takes a list of operations, using ids from `read`:

```json
[
  { "id": "pay", "label": "Stripe Checkout\n+ Apple Pay" },
  { "id": "login", "color": "red", "style": "dashed" },
  { "id": "cart", "moveBy": { "x": 0, "y": -40 } },
  { "id": "auth", "x": 300, "y": 120, "w": 220, "h": 140 },
  { "op": "delete", "id": "n1" }
]
```

- Moving or resizing re-routes connected arrows.
- Deleting a shape also deletes its label and connected arrows. Add `"keepArrows": true` to keep the arrows.
- Only change elements the user asked about. Never delete the user's markups unless they ask.

## Images

`node $S add-image "Project/Board" path/to/image.png [--x N --y N --width N]` puts a PNG, JPEG or WebP on the
board. By default it goes to the right of existing content. Use it for screenshots Claude produced, such as a
before/after of a UI change, so the user can mark them up.

## After changing a board

Tell the user what you added or changed and on which board. Mention:
- the board updates live if it's open, otherwise when they open it;
- ⌘Z in SketchNotes undoes Claude's change.
