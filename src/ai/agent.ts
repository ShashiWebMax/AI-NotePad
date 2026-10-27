// Builds AI context from the canvas, asks the model for structured edits, and applies them.
//
// Coordinate system shared with the model: the snapshot image's pixels. Element positions
// are converted into that frame before sending and converted back when applying edits.

import { CaptureUpdateAction, exportToBlob, getCommonBounds } from "@excalidraw/excalidraw";
import { chat, generateImage, type InputImage } from "./providers";
import type { Settings } from "../settings";
import { arrowFromPoints, bindArrow, bump, center, edgePoint, elBox, toElements, type Box, type El } from "../scene";

export type Scope = "auto" | "board";

export interface Frame {
  minX: number; // scene x at image pixel 0
  minY: number;
  scale: number; // image px per scene unit
  width: number; // image px
  height: number;
  hasImage: boolean;
}

export interface Context {
  frame: Frame;
  image: InputImage | null;
  elements: any[];
  boardText: string;
  scopeLabel: string;
  sceneBox: Box; // area the context covers, in scene units
}

export interface HistoryTurn {
  prompt: string;
  reply: string;
}

export interface AIResult {
  message?: string;
  notes_markdown?: string;
  add?: any[];
  update?: any[];
  delete?: string[];
  generate_image?: { prompt: string } | null;
}

const MAX_SIDE = 1568;
const PAD = 24;

const blobToB64 = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve((fr.result as string).split(",")[1]);
    fr.onerror = () => reject(fr.error);
    fr.readAsDataURL(blob);
  });

function viewportBox(appState: any): Box {
  const z = appState.zoom?.value ?? 1;
  return { x: -appState.scrollX, y: -appState.scrollY, w: appState.width / z, h: appState.height / z };
}

const intersects = (a: Box, b: Box) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

export async function buildContext(api: any, scope: Scope): Promise<Context> {
  const all: El[] = api.getSceneElements().filter((e: El) => !e.isDeleted);
  const appState = api.getAppState();
  const files = api.getFiles();
  const selected = new Set(Object.keys(appState.selectedElementIds || {}).filter((id) => appState.selectedElementIds[id]));

  let scoped: El[];
  let scopeLabel: string;
  if (scope === "board") {
    scoped = all;
    scopeLabel = "the whole board";
  } else if (selected.size) {
    // include labels of selected containers and containers of selected labels
    const ids = new Set(selected);
    for (const e of all) {
      if (ids.has(e.id)) e.boundElements?.forEach((b: El) => b.type === "text" && ids.add(b.id));
      if (e.type === "text" && e.containerId && ids.has(e.id)) ids.add(e.containerId);
    }
    scoped = all.filter((e) => ids.has(e.id));
    scopeLabel = `the user's selection (${selected.size} element${selected.size > 1 ? "s" : ""})`;
  } else {
    const vp = viewportBox(appState);
    scoped = all.filter((e) => intersects(elBox(e), vp));
    scopeLabel = "what is visible on screen";
  }

  let frame: Frame;
  let image: InputImage | null = null;
  let sceneBox: Box;

  if (scoped.length) {
    const [minX, minY, maxX, maxY] = getCommonBounds(scoped);
    const w = maxX - minX + PAD * 2;
    const h = maxY - minY + PAD * 2;
    const scale = Math.min(2, MAX_SIDE / Math.max(w, h));
    const blob = await exportToBlob({
      elements: scoped,
      appState: { ...appState, exportBackground: true, viewBackgroundColor: "#ffffff", exportWithDarkMode: false },
      files,
      mimeType: "image/png",
      exportPadding: PAD,
      getDimensions: (cw: number, ch: number) => ({ width: cw * scale, height: ch * scale, scale }),
    });
    image = { mime: "image/png", b64: await blobToB64(blob) };
    frame = { minX: minX - PAD, minY: minY - PAD, scale, width: Math.round(w * scale), height: Math.round(h * scale), hasImage: true };
    sceneBox = { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
  } else {
    const vp = viewportBox(appState);
    frame = { minX: vp.x, minY: vp.y, scale: 1, width: Math.round(vp.w), height: Math.round(vp.h), hasImage: false };
    sceneBox = vp;
  }

  const toF = (v: number, o: number) => Math.round((v - o) * frame.scale);
  const textOf = (id: string) => all.find((t) => t.id === id)?.text;
  const elements = scoped
    .filter((e) => !(e.type === "text" && e.containerId))
    .slice(0, 300)
    .map((e) => {
      const b = elBox(e);
      const d: any = { id: e.id, type: e.type, x: toF(b.x, frame.minX), y: toF(b.y, frame.minY), w: Math.round(b.w * frame.scale), h: Math.round(b.h * frame.scale) };
      if (e.type === "text") d.text = e.text;
      const label = e.boundElements?.find((b: El) => b.type === "text");
      if (label) d.label = textOf(label.id);
      if (e.strokeColor && e.type !== "image") d.color = e.strokeColor;
      if (e.backgroundColor && e.backgroundColor !== "transparent") d.fill = e.backgroundColor;
      if (e.opacity < 100) d.opacity = e.opacity;
      if (e.type === "arrow") {
        if (e.startBinding) d.from = e.startBinding.elementId;
        if (e.endBinding) d.to = e.endBinding.elementId;
      }
      return d;
    });

  const boardText = all
    .filter((e) => e.type === "text" && e.text?.trim())
    .map((e) => `- ${e.text.replace(/\s+/g, " ").trim()}`)
    .join("\n")
    .slice(0, 8000);

  return { frame, image, elements, boardText, scopeLabel, sceneBox };
}

export const SYSTEM_PROMPT = `You are the AI assistant inside SketchNotes, an infinite whiteboard used during client video calls.
The user drops in app screenshots, highlights areas, sketches ideas and writes notes about requested changes.
You can see a snapshot of part of the board and a list of its elements, and you reply with edits to make on the board.

COORDINATES: every x, y, w, h, points and fontSize you read or write is in pixels of the snapshot image ("frame"),
origin top-left. You may place things outside the frame (negative values or beyond its size), e.g. notes beside it.

Reply with ONE JSON object and nothing else:
{
  "message": "one or two sentences telling the user what you did or answering them",
  "notes_markdown": "optional markdown, only when the user asks for notes, a summary, a task list, a spec, an email etc.",
  "add": [ ...new elements... ],
  "update": [ { "id": "existing id", ...fields to change... } ],
  "delete": [ "existing id", ... ],
  "generate_image": { "prompt": "detailed prompt" }   // optional, see below
}
All keys except "message" are optional. Do not invent ids for update/delete.

New element fields:
  type: "rectangle" | "ellipse" | "diamond" | "text" | "arrow" | "line" | "highlight" | "sticky"
  ref: your own short name so arrows in the same reply can point at it
  x, y, w, h: box (not needed for arrows/lines that use from/to)
  text: for "text" and "sticky", or as the label inside a rectangle/ellipse/diamond
  fontSize: default 20 (in frame px)
  color: stroke/text colour, fill: background colour, fillStyle: "solid" | "hachure" | "cross-hatch"
  strokeWidth: 1 | 2 | 4, strokeStyle: "solid" | "dashed" | "dotted", opacity: 0-100
  arrows/lines: either "from"/"to" (an existing id or a ref, the arrow connects and stays attached)
                or "points": [[x,y],[x,y],...] absolute frame px. Optional "startArrowhead"/"endArrowhead":
                "arrow" | "triangle" | "dot" | "bar" | null (arrows default to an end arrowhead).
  "highlight": translucent marker box over an area (default yellow), use it to point at parts of a screenshot.
  "sticky": a note card with text (default yellow), good for comments and change requests.

Update fields: x, y, w, h, text, color, fill, opacity, strokeWidth, strokeStyle.

Guidelines:
- Annotate screenshots without covering them: use "highlight", outline rectangles/ellipses with no fill, red (#e03131)
  for change requests, and arrows from sticky notes to the area they talk about.
- Put new notes and diagrams in empty space next to the content (usually to the right), not on top of it.
- Diagram style: clean, aligned, consistent sizes, about 40-80px gaps, short labels.
- Freehand strokes (type "freedraw") are the user's hand drawing: interpret them (circled areas, arrows, crossed-out parts, handwriting).
- Use "generate_image" only when the user wants a picture: a redesigned screen/mockup, rendering, illustration or photo.
  Write a complete prompt for an image model describing the result; the snapshot is passed to it as reference.
- If the user only asks a question, answer in "message" and change nothing.`;

function userText(ctx: Context, prompt: string, history: HistoryTurn[]) {
  const f = ctx.frame;
  const parts = [
    `User request: ${prompt}`,
    `Context: ${ctx.scopeLabel}.`,
    f.hasImage
      ? `The attached snapshot is ${f.width}x${f.height} px.`
      : `No snapshot: this area of the board is empty. The frame is the visible screen, ${f.width}x${f.height} px.`,
    `Elements in the frame (JSON):\n${JSON.stringify(ctx.elements)}`,
  ];
  if (ctx.boardText) parts.push(`All text written on the board:\n${ctx.boardText}`);
  if (history.length) {
    parts.push(
      "Earlier in this session:\n" + history.slice(-4).map((h) => `User: ${h.prompt}\nYou: ${h.reply}`).join("\n"),
    );
  }
  return parts.join("\n\n");
}

export function parseJSON(text: string): AIResult {
  const cleaned = text.replace(/```(?:json)?/g, "");
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end === -1) return { message: text.trim() };
  try {
    return JSON.parse(cleaned.slice(start, end + 1));
  } catch {
    return { message: text.trim() };
  }
}

// ---------------------------------------------------------------- applying edits

const rid = () => Math.random().toString(36).slice(2, 12) + Date.now().toString(36).slice(-4);

const num = (v: any, d: number) => (typeof v === "number" && isFinite(v) ? v : d);

function styleProps(spec: any, frame: Frame) {
  const p: any = {};
  if (spec.color) p.strokeColor = spec.color;
  if (spec.fill) p.backgroundColor = spec.fill;
  if (spec.fillStyle) p.fillStyle = spec.fillStyle;
  else if (spec.fill) p.fillStyle = "solid";
  if (spec.strokeWidth) p.strokeWidth = spec.strokeWidth;
  if (spec.strokeStyle) p.strokeStyle = spec.strokeStyle;
  if (spec.opacity !== undefined) p.opacity = Math.max(0, Math.min(100, spec.opacity));
  if (spec.fontSize) p.fontSize = Math.max(14, Math.min(160, spec.fontSize / frame.scale));
  return p;
}

export function applyResult(api: any, ctx: Context, result: AIResult): { addedIds: string[]; changed: number } {
  const { frame } = ctx;
  const sx = (v: number) => frame.minX + v / frame.scale;
  const sy = (v: number) => frame.minY + v / frame.scale;
  const sl = (v: number) => v / frame.scale;

  let elements: El[] = [...api.getSceneElementsIncludingDeleted()];
  const byId = () => new Map(elements.map((e) => [e.id, e]));
  let changed = 0;

  // ---- delete
  const del = new Set(result.delete ?? []);
  if (del.size) {
    for (const e of elements) if (e.type === "text" && e.containerId && del.has(e.containerId)) del.add(e.id);
    elements = elements.map((e) => {
      if (del.has(e.id)) { changed++; return bump(e, { isDeleted: true }); }
      if (e.type === "arrow" && (del.has(e.startBinding?.elementId) || del.has(e.endBinding?.elementId))) {
        return bump(e, {
          startBinding: del.has(e.startBinding?.elementId) ? null : e.startBinding,
          endBinding: del.has(e.endBinding?.elementId) ? null : e.endBinding,
        });
      }
      return e;
    });
  }

  // ---- update
  for (const u of result.update ?? []) {
    const map = byId();
    const el = map.get(u.id);
    if (!el || el.isDeleted) continue;
    changed++;
    const changes: any = styleProps(u, frame);
    delete changes.fontSize;
    if (typeof u.x === "number") changes.x = sx(u.x);
    if (typeof u.y === "number") changes.y = sy(u.y);
    const linear = el.type === "arrow" || el.type === "line" || el.type === "freedraw";
    if (!linear && typeof u.w === "number") changes.width = Math.max(4, sl(u.w));
    if (!linear && typeof u.h === "number") changes.height = Math.max(4, sl(u.h));
    const dx = (changes.x ?? el.x) - el.x;
    const dy = (changes.y ?? el.y) - el.y;

    const labelRef = el.boundElements?.find((b: El) => b.type === "text");
    const label = labelRef ? map.get(labelRef.id) : null;

    if (typeof u.text === "string" && (el.type === "text" || ["rectangle", "ellipse", "diamond"].includes(el.type))) {
      // re-create text so Excalidraw measures it again; keep the same id so arrows stay bound
      const merged = { ...el, ...changes };
      let rebuilt: El[];
      if (el.type === "text" && !el.containerId) {
        rebuilt = toElements([{ type: "text", id: el.id, x: merged.x, y: merged.y, text: u.text, fontSize: el.fontSize, fontFamily: el.fontFamily, strokeColor: merged.strokeColor, opacity: merged.opacity, textAlign: el.textAlign }]);
      } else {
        rebuilt = toElements([{
          type: el.type, id: el.id, x: merged.x, y: merged.y, width: merged.width, height: merged.height,
          strokeColor: merged.strokeColor, backgroundColor: merged.backgroundColor, fillStyle: merged.fillStyle,
          strokeWidth: merged.strokeWidth, strokeStyle: merged.strokeStyle, roughness: merged.roughness,
          opacity: merged.opacity, roundness: merged.roundness,
          label: { text: u.text, fontSize: label?.fontSize, strokeColor: label?.strokeColor, textAlign: label?.textAlign, verticalAlign: label?.verticalAlign },
        }]);
        const arrows = (el.boundElements || []).filter((b: El) => b.type === "arrow");
        rebuilt[0] = { ...rebuilt[0], boundElements: [...(rebuilt[0].boundElements || []), ...arrows] };
      }
      rebuilt = rebuilt.map((r) => ({ ...r, version: (map.get(r.id)?.version ?? 1) + 1 }));
      elements = elements.filter((e) => e.id !== el.id && e.id !== label?.id).concat(rebuilt);
      continue;
    }

    elements = elements.map((e) => {
      if (e.id === el.id) return bump(e, changes);
      if (label && e.id === label.id && (dx || dy)) return bump(e, { x: e.x + dx, y: e.y + dy });
      return e;
    });
  }

  // ---- add
  const refs = new Map<string, string>(); // ref -> id
  const specs = (result.add ?? []).filter((s) => s && typeof s.type === "string");
  const pendingArrows: { spec: any; id: string }[] = [];
  const skeletons: any[] = [];
  for (const spec of specs) {
    const id = rid();
    if (spec.ref) refs.set(String(spec.ref), id);
    const t = spec.type;
    if (t === "arrow" || t === "line") {
      pendingArrows.push({ spec, id });
      continue;
    }
    const x = sx(num(spec.x, 0)), y = sy(num(spec.y, 0));
    const w = Math.max(8, sl(num(spec.w, 200))), h = Math.max(8, sl(num(spec.h, 100)));
    const style = styleProps(spec, frame);
    const fontSize = style.fontSize ?? 20;
    delete style.fontSize;
    if (t === "text") {
      skeletons.push({ type: "text", id, x, y, text: String(spec.text ?? ""), fontSize, strokeColor: style.strokeColor ?? "#1e1e1e", opacity: style.opacity });
    } else if (t === "highlight") {
      skeletons.push({
        type: "rectangle", id, x, y, width: w, height: h,
        strokeColor: "transparent", backgroundColor: spec.fill ?? "#ffd43b", fillStyle: "solid",
        opacity: spec.opacity ?? 35, roughness: 0, roundness: { type: 3 },
      });
    } else if (t === "sticky") {
      skeletons.push({
        type: "rectangle", id, x, y, width: Math.max(w, 160), height: Math.max(h, 80),
        strokeColor: style.strokeColor ?? "#f08c00", backgroundColor: spec.fill ?? "#fff3bf", fillStyle: "solid",
        roughness: 0, roundness: { type: 3 }, strokeWidth: 1,
        label: { text: String(spec.text ?? ""), fontSize, textAlign: "left", verticalAlign: "top", strokeColor: "#1e1e1e" },
      });
    } else if (["rectangle", "ellipse", "diamond"].includes(t)) {
      // make sure a label fits without breaking words (diamonds/ellipses have less room inside)
      let minW = 0, minH = 0;
      if (spec.text) {
        const lines = String(spec.text).split("\n");
        const longestWord = Math.max(...String(spec.text).split(/\s+/).map((s) => s.length));
        const room = t === "rectangle" ? 1.15 : 1.7;
        minW = Math.max(longestWord, Math.min(28, Math.max(...lines.map((l) => l.length)))) * fontSize * 0.6 * room + 20;
        minH = lines.length * fontSize * 1.4 * room + 16;
      }
      skeletons.push({
        type: t, id, x, y, width: Math.max(w, minW), height: Math.max(h, minH),
        strokeColor: "#1e1e1e", backgroundColor: "transparent", roundness: t === "ellipse" ? null : { type: t === "rectangle" ? 3 : 2 },
        ...style,
        ...(spec.text ? { label: { text: String(spec.text), fontSize } } : {}),
      });
    }
  }
  const created = skeletons.length ? toElements(skeletons) : [];
  elements = elements.concat(created);

  // arrows need the final boxes of whatever they connect
  for (const { spec, id } of pendingArrows) {
    const map = byId();
    const resolve = (r: any) => (r == null ? null : map.get(refs.get(String(r)) ?? String(r)) ?? null);
    const fromEl = resolve(spec.from);
    const toEl = resolve(spec.to);
    let pts: { x: number; y: number }[] | null = null;
    if (fromEl && toEl) {
      const a = elBox(fromEl), b = elBox(toEl);
      pts = [edgePoint(a, center(b)), edgePoint(b, center(a))];
    } else if (Array.isArray(spec.points) && spec.points.length >= 2) {
      pts = spec.points.map((p: number[]) => ({ x: sx(num(p[0], 0)), y: sy(num(p[1], 0)) }));
      if (fromEl) pts![0] = edgePoint(elBox(fromEl), pts![1]);
      if (toEl) pts![pts!.length - 1] = edgePoint(elBox(toEl), pts![pts!.length - 2]);
    } else if (fromEl || toEl) {
      continue; // not enough information
    }
    if (!pts) continue;
    const style = styleProps(spec, frame);
    delete style.fontSize;
    const isLine = spec.type === "line";
    const sk: any = arrowFromPoints(pts, {
      id,
      strokeColor: "#1e1e1e",
      ...style,
      startArrowhead: spec.startArrowhead ?? null,
      endArrowhead: spec.endArrowhead !== undefined ? spec.endArrowhead : isLine ? null : "arrow",
      roundness: pts.length > 2 ? { type: 2 } : null,
      ...(spec.text ? { label: { text: String(spec.text) } } : {}),
    });
    const made = toElements([sk]);
    elements = elements.concat(made);
    if (fromEl || toEl) elements = bindArrow(elements, id, fromEl?.id ?? null, toEl?.id ?? null);
  }

  const addedIds = [...skeletons.map((s) => s.id), ...pendingArrows.map((p) => p.id)].filter((id) => elements.some((e) => e.id === id));
  changed += addedIds.length;

  api.updateScene({
    elements,
    appState: addedIds.length ? { selectedElementIds: Object.fromEntries(addedIds.map((id) => [id, true])) } : undefined,
    captureUpdate: CaptureUpdateAction.IMMEDIATELY,
  });
  return { addedIds, changed };
}

// ---------------------------------------------------------------- placing things next to the context

/** Finds a free spot of the given size to the right of `anchor`. */
function freeSpot(api: any, anchor: Box, w: number, h: number) {
  const boxes = api.getSceneElements().filter((e: El) => !e.isDeleted).map(elBox);
  let x = anchor.x + anchor.w + 80;
  const y = anchor.y;
  for (let i = 0; i < 30; i++) {
    const hit = boxes.find((b: Box) => intersects(b, { x: x - 20, y: y - 20, w: w + 40, h: h + 40 }));
    if (!hit) break;
    x = hit.x + hit.w + 60;
  }
  return { x, y };
}

function loadImageSize(dataURL: string) {
  return new Promise<{ w: number; h: number }>((resolve) => {
    const img = new Image();
    img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
    img.onerror = () => resolve({ w: 1024, h: 1024 });
    img.src = dataURL;
  });
}

export async function insertImage(api: any, anchor: Box, mime: string, b64: string, caption: string) {
  const dataURL = `data:${mime};base64,${b64}`;
  const fileId = rid();
  api.addFiles([{ id: fileId, dataURL, mimeType: mime, created: Date.now() }]);
  const size = await loadImageSize(dataURL);
  const targetW = Math.min(size.w, Math.max(480, Math.min(anchor.w, 1000)));
  const w = targetW, h = (size.h / size.w) * targetW;
  const { x, y } = freeSpot(api, anchor, w, h + 50);
  const made = toElements([
    { type: "text", x, y, text: caption.length > 90 ? caption.slice(0, 87) + "…" : caption, fontSize: 16, strokeColor: "#868e96" },
    { type: "image", x, y: y + 34, width: w, height: h, fileId, status: "saved" },
  ]);
  api.updateScene({
    elements: [...api.getSceneElementsIncludingDeleted(), ...made],
    appState: { selectedElementIds: Object.fromEntries(made.map((e: El) => [e.id, true])) },
    captureUpdate: CaptureUpdateAction.IMMEDIATELY,
  });
  api.scrollToContent(made, { animate: true, fitToViewport: false });
}

export function markdownToPlain(md: string) {
  return md
    .replace(/^#{1,6}\s*/gm, "")
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/__(.+?)__/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/^\s*[-*]\s+\[ \]\s*/gm, "☐ ")
    .replace(/^\s*[-*]\s+\[x\]\s*/gim, "☑ ")
    .replace(/^(\s*)[-*]\s+/gm, "$1• ")
    .trim();
}

export function insertNote(api: any, anchor: Box, markdown: string) {
  const text = markdownToPlain(markdown);
  const w = 440;
  const { x, y } = freeSpot(api, anchor, w, 300);
  const made = toElements([
    {
      type: "rectangle", x, y, width: w, height: 120,
      strokeColor: "#f08c00", backgroundColor: "#fff3bf", fillStyle: "solid", roughness: 0, strokeWidth: 1, roundness: { type: 3 },
      label: { text, fontSize: 16, textAlign: "left", verticalAlign: "top", strokeColor: "#1e1e1e" },
    },
  ]);
  api.updateScene({
    elements: [...api.getSceneElementsIncludingDeleted(), ...made],
    appState: { selectedElementIds: { [made[0].id]: true } },
    captureUpdate: CaptureUpdateAction.IMMEDIATELY,
  });
  api.scrollToContent(made, { animate: true, fitToViewport: false });
}

// ---------------------------------------------------------------- top-level actions

export type Mode = "canvas" | "image";

export interface RunOutput {
  message: string;
  notes?: string;
  imageText?: string;
  changed: number;
}

const IMAGE_PREAMBLE =
  "The attached picture is a snapshot of a whiteboard from a client meeting. It may contain an app screenshot plus " +
  "highlights, arrows, sketches and handwritten or typed notes describing requested changes. Use it as the reference. ";

export async function runAI(
  api: any,
  settings: Settings,
  prompt: string,
  mode: Mode,
  scope: Scope,
  history: HistoryTurn[],
  onStatus: (s: string) => void,
  signal?: AbortSignal,
): Promise<RunOutput> {
  onStatus("Reading the board…");
  const ctx = await buildContext(api, scope);

  if (mode === "image") {
    onStatus("Generating image…");
    const img = await generateImage(settings, IMAGE_PREAMBLE + prompt, ctx.image ? [ctx.image] : [], undefined, signal);
    await insertImage(api, ctx.sceneBox, img.mime, img.b64, `AI image: ${prompt}`);
    return { message: "Image added next to the selection.", imageText: img.text, changed: 1 };
  }

  onStatus("Thinking…");
  let fallbackNote = "";
  const raw = await chat(settings, {
    onFallback: (from, to) => { fallbackNote = `(${from} was unavailable, so ${to} answered.)`; },
    system: SYSTEM_PROMPT,
    text: userText(ctx, prompt, history),
    images: ctx.image ? [ctx.image] : [],
    json: true,
    signal,
  });
  signal?.throwIfAborted();
  const result = parseJSON(raw);
  onStatus("Applying changes…");
  const { changed } = applyResult(api, ctx, result);

  let imageText: string | undefined;
  if (result.generate_image?.prompt) {
    onStatus("Generating image…");
    const img = await generateImage(settings, IMAGE_PREAMBLE + result.generate_image.prompt, ctx.image ? [ctx.image] : [], undefined, signal);
    await insertImage(api, ctx.sceneBox, img.mime, img.b64, `AI image: ${prompt}`);
    imageText = img.text;
  }

  return {
    message: [result.message || (changed ? "Done." : "No changes."), fallbackNote].filter(Boolean).join(" "),
    notes: result.notes_markdown || undefined,
    imageText,
    changed: changed + (result.generate_image?.prompt ? 1 : 0),
  };
}
