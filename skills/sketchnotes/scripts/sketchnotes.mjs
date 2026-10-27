#!/usr/bin/env node
// SketchNotes helper for Claude: read boards (screenshots + markups) and draw editable diagrams.
// Boards are Excalidraw JSON files inside the SketchNotes projects folder:
//   <folder>/<Project>/<Board>.excalidraw, <Board>.preview.png, files/<id>.png, exports/
// The SketchNotes app watches the open board and merges these edits live.
// No dependencies; Node 18+.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const SKILL_DIR = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const CONFIG = path.join(SKILL_DIR, "config.json");
const EXT = ".excalidraw";
const PREVIEW = ".preview.png";

// ------------------------------------------------------------------ cli

const USAGE = `Usage: node sketchnotes.mjs <command> [args]

  where                              show the projects folder
  set-folder <path>                  remember the projects folder
  list                               list projects and boards
  read <Project/Board> [--json]      describe a board: screenshots, markups, notes, diagram
  new <Project/Board>                create an empty board (creates the project if needed)
  draw <Project/Board> <spec.json|-> add a diagram / annotations (see SKILL.md for the spec)
  edit <Project/Board> <ops.json|->  update, move, relabel or delete elements by id
  add-image <Project/Board> <image> [--x N --y N --width N]   put a PNG/JPEG on the board

Options: --dir <folder> overrides the projects folder for one command.`;

const argv = process.argv.slice(2);
const flags = {};
const args = [];
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a.startsWith("--")) {
    const k = a.slice(2);
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith("--") && k !== "json") (flags[k] = next), i++;
    else flags[k] = true;
  } else args.push(a);
}

const die = (msg) => {
  console.error(msg);
  process.exit(1);
};

// ------------------------------------------------------------------ folder + board paths

function readConfig() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG, "utf8"));
  } catch {
    return {};
  }
}

function projectsFolder() {
  const expand = (p) => path.resolve(p.replace(/^~(?=$|\/)/, os.homedir()));
  const candidates = [
    flags.dir && ["--dir", flags.dir],
    process.env.SKETCHNOTES_DIR && ["SKETCHNOTES_DIR", process.env.SKETCHNOTES_DIR],
    readConfig().dir && ["config.json", readConfig().dir],
    ["default", "~/Documents/SketchNotes"],
  ].filter(Boolean);
  for (const [source, p] of candidates) {
    const dir = expand(p);
    if (fs.existsSync(dir) && fs.statSync(dir).isDirectory()) return { dir, source };
    if (source !== "default") die(`Projects folder not found: ${dir} (from ${source}).`);
  }
  die(
    "No SketchNotes projects folder is set up yet. Ask the user which folder they opened with " +
      "'Open projects folder…' in SketchNotes, then run: node sketchnotes.mjs set-folder <path>",
  );
}

const safeName = (n) => n.replace(/[\\/:*?"<>|]/g, "-").trim();

/** "Project/Board" (or a path to a .excalidraw file) -> paths */
function boardPaths(ref, { create = false } = {}) {
  if (!ref) die("Missing board. Use \"Project/Board\" (run `list` to see them).");
  let file;
  if (ref.endsWith(EXT) && fs.existsSync(ref)) file = path.resolve(ref);
  else {
    const { dir } = projectsFolder();
    const i = ref.indexOf("/");
    if (i < 1) die(`Board must be "Project/Board", got "${ref}".`);
    const project = safeName(ref.slice(0, i));
    const board = safeName(ref.slice(i + 1).replace(new RegExp(`${EXT}$`), ""));
    file = path.join(dir, project, board + EXT);
    if (!fs.existsSync(file) && !create) {
      const projDir = path.join(dir, project);
      const have = fs.existsSync(projDir) ? listBoards(projDir) : [];
      die(`Board not found: ${file}${have.length ? `\nBoards in "${project}": ${have.join(", ")}` : ""}`);
    }
  }
  const projectDir = path.dirname(file);
  const board = path.basename(file, EXT);
  return { file, projectDir, board, preview: path.join(projectDir, board + PREVIEW), project: path.basename(projectDir) };
}

const listBoards = (projectDir) =>
  fs.readdirSync(projectDir).filter((f) => f.endsWith(EXT)).map((f) => f.slice(0, -EXT.length)).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

function loadDoc(file) {
  const doc = JSON.parse(fs.readFileSync(file, "utf8"));
  doc.elements = (doc.elements || []).filter((e) => !e.isDeleted);
  doc.fileIndex ||= {};
  return doc;
}

/** Atomic write, so the app never reads a half-written file. */
function saveDoc(file, doc) {
  const tmp = path.join(path.dirname(file), `.${path.basename(file)}.${process.pid}.tmp`);
  fs.writeFileSync(tmp, JSON.stringify({ type: "excalidraw", version: 2, source: "sketchnotes", appState: {}, files: {}, ...doc }));
  fs.renameSync(tmp, file);
}

const emptyDoc = () => ({ type: "excalidraw", version: 2, source: "sketchnotes", elements: [], appState: {}, files: {}, fileIndex: {} });

function readInput(src) {
  if (!src) die("Missing spec file (or - for stdin).");
  const text = src === "-" ? fs.readFileSync(0, "utf8") : fs.readFileSync(src, "utf8");
  try {
    return JSON.parse(text);
  } catch (e) {
    die(`Spec is not valid JSON: ${e.message}`);
  }
}

// ------------------------------------------------------------------ geometry

function bbox(e) {
  if (Array.isArray(e.points) && e.points.length) {
    const xs = e.points.map((p) => p[0]), ys = e.points.map((p) => p[1]);
    const x1 = e.x + Math.min(...xs), y1 = e.y + Math.min(...ys);
    return { x: x1, y: y1, w: e.x + Math.max(...xs) - x1, h: e.y + Math.max(...ys) - y1 };
  }
  return { x: e.x, y: e.y, w: e.width || 0, h: e.height || 0 };
}
const center = (b) => ({ x: b.x + b.w / 2, y: b.y + b.h / 2 });
const inside = (p, b, m = 0) => p.x >= b.x - m && p.x <= b.x + b.w + m && p.y >= b.y - m && p.y <= b.y + b.h + m;
function overlap(a, b) {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}
function contentBounds(elements) {
  if (!elements.length) return null;
  const bs = elements.map(bbox);
  const x1 = Math.min(...bs.map((b) => b.x)), y1 = Math.min(...bs.map((b) => b.y));
  return { x: x1, y: y1, w: Math.max(...bs.map((b) => b.x + b.w)) - x1, h: Math.max(...bs.map((b) => b.y + b.h)) - y1 };
}
/** Point on the edge of box b, on the line from its centre towards `to`. */
function edgePoint(b, to, gap = 6, shape = "rectangle") {
  const c = center(b);
  const dx = to.x - c.x, dy = to.y - c.y;
  if (!dx && !dy) return c;
  let s;
  if (shape === "ellipse") s = 1 / Math.sqrt((dx / (b.w / 2 + gap)) ** 2 + (dy / (b.h / 2 + gap)) ** 2);
  else if (shape === "diamond") s = 1 / (Math.abs(dx) / (b.w / 2 + gap) + Math.abs(dy) / (b.h / 2 + gap));
  else s = Math.min(dx ? (b.w / 2 + gap) / Math.abs(dx) : Infinity, dy ? (b.h / 2 + gap) / Math.abs(dy) : Infinity);
  return { x: c.x + dx * s, y: c.y + dy * s };
}

// ------------------------------------------------------------------ colours

const PALETTE = {
  blue: ["#1971c2", "#a5d8ff"],
  green: ["#2f9e44", "#b2f2bb"],
  red: ["#e03131", "#ffc9c9"],
  yellow: ["#f08c00", "#ffec99"],
  orange: ["#e8590c", "#ffd8a8"],
  purple: ["#6741d9", "#d0bfff"],
  pink: ["#c2255c", "#fcc2d7"],
  teal: ["#0c8599", "#99e9f2"],
  gray: ["#495057", "#e9ecef"],
  grey: ["#495057", "#e9ecef"],
  black: ["#1e1e1e", "transparent"],
};
function colors(name, fallback = ["#1e1e1e", "transparent"]) {
  if (!name) return fallback;
  if (PALETTE[name]) return PALETTE[name];
  if (/^#[0-9a-f]{3,8}$/i.test(name)) return [name, "transparent"];
  return fallback;
}
function hsl(hex) {
  const m = /^#?([0-9a-f]{6})/i.exec(hex || "");
  if (!m) return null;
  const n = parseInt(m[1], 16);
  const r = ((n >> 16) & 255) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2, d = max - min;
  if (!d) return { h: 0, s: 0, l };
  const s = d / (1 - Math.abs(2 * l - 1));
  let h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return { h: (h * 60 + 360) % 360, s, l };
}
const isRed = (c) => { const v = hsl(c); return !!v && v.s > 0.45 && v.l < 0.75 && (v.h >= 340 || v.h <= 15); };
const isYellowish = (c) => { const v = hsl(c); return !!v && v.s > 0.4 && v.h >= 35 && v.h <= 65; };
function colorName(c) {
  const v = hsl(c);
  if (!c || c === "transparent") return "none";
  if (!v || v.s < 0.15) return v && v.l > 0.8 ? "light gray" : v && v.l < 0.25 ? "black" : "gray";
  const names = [[15, "red"], [40, "orange"], [65, "yellow"], [170, "green"], [200, "teal"], [250, "blue"], [290, "purple"], [340, "pink"], [360, "red"]];
  return names.find(([max]) => v.h <= max)[1];
}

// ------------------------------------------------------------------ images on disk

function imageSize(file) {
  const b = fs.readFileSync(file);
  if (b.length > 24 && b.readUInt32BE(0) === 0x89504e47) return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
  if (b[0] === 0xff && b[1] === 0xd8) {
    let i = 2;
    while (i < b.length) {
      if (b[i] !== 0xff) { i++; continue; }
      const m = b[i + 1];
      if (m >= 0xc0 && m <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(m)) return { h: b.readUInt16BE(i + 5), w: b.readUInt16BE(i + 7) };
      i += 2 + b.readUInt16BE(i + 2);
    }
  }
  if (b.slice(0, 4).toString() === "RIFF" && b.slice(8, 12).toString() === "WEBP") {
    const chunk = b.slice(12, 16).toString();
    if (chunk === "VP8X") return { w: 1 + b.readUIntLE(24, 3), h: 1 + b.readUIntLE(27, 3) };
    if (chunk === "VP8 ") return { w: b.readUInt16LE(26) & 0x3fff, h: b.readUInt16LE(28) & 0x3fff };
  }
  return null;
}

// ------------------------------------------------------------------ element factory

const newId = (prefix = "") => (prefix ? `${prefix}-` : "") + crypto.randomBytes(6).toString("base64url");
const nonce = () => crypto.randomInt(1, 2 ** 31 - 1);

function base(type, x, y, w, h, extra = {}) {
  return {
    id: newId(),
    type,
    x: Math.round(x),
    y: Math.round(y),
    width: Math.round(w),
    height: Math.round(h),
    angle: 0,
    strokeColor: "#1e1e1e",
    backgroundColor: "transparent",
    fillStyle: "solid",
    strokeWidth: 2,
    strokeStyle: "solid",
    roughness: 1,
    opacity: 100,
    groupIds: [],
    frameId: null,
    roundness: null,
    seed: nonce(),
    version: 1,
    versionNonce: nonce(),
    isDeleted: false,
    boundElements: [],
    updated: Date.now(),
    link: null,
    locked: false,
    ...extra,
  };
}

const FONT = 5; // Excalifont, the hand-drawn font the app uses
const LINE = 1.25;
const textSize = (text, fontSize) => {
  const lines = String(text).split("\n");
  return { w: Math.max(...lines.map((l) => l.length), 1) * fontSize * 0.58, h: lines.length * fontSize * LINE };
};

function textEl(text, x, y, { fontSize = 20, color = "#1e1e1e", align = "left", valign = "top", containerId = null } = {}) {
  const s = textSize(text, fontSize);
  return base("text", x, y, s.w, s.h, {
    strokeColor: color,
    text: String(text),
    originalText: String(text),
    fontSize,
    fontFamily: FONT,
    textAlign: align,
    verticalAlign: valign,
    containerId,
    autoResize: true,
    lineHeight: LINE,
    customData: { needsMeasure: true }, // the app measures it with the real font on load
  });
}

/** A label centred in (or for stickies, at the top-left of) a container. */
function labelFor(container, text, opts = {}) {
  const fontSize = opts.fontSize ?? 20;
  const s = textSize(text, fontSize);
  const top = opts.valign === "top";
  const x = top ? container.x + 12 : container.x + (container.width - s.w) / 2;
  const y = top ? container.y + 10 : container.y + (container.height - s.h) / 2;
  const t = textEl(text, x, y, { ...opts, containerId: container.id, align: top ? "left" : "center", valign: top ? "top" : "middle" });
  container.boundElements = [...(container.boundElements || []), { id: t.id, type: "text" }];
  return t;
}

function nodeSize(node) {
  const fontSize = node.fontSize ?? 20;
  const label = node.label ?? node.text ?? "";
  const s = textSize(label, fontSize);
  let w = Math.max(140, s.w + 48), h = Math.max(64, s.h + 32);
  if (node.shape === "diamond") (w *= 1.6), (h *= 1.6);
  if (node.shape === "ellipse") (w *= 1.3), (h *= 1.3);
  if (node.shape === "sticky") (w = Math.max(200, s.w + 32)), (h = Math.max(100, s.h + 28));
  if (node.shape === "text") (w = s.w), (h = s.h);
  return { w: node.w ?? Math.round(w), h: node.h ?? Math.round(h) };
}

/** Builds Excalidraw elements for one spec node. Returns [main, ...extras]. */
function buildNode(node, x, y, w, h) {
  const shape = node.shape || "rectangle";
  const [stroke, fill] = colors(node.color, ["#1e1e1e", "transparent"]);
  const label = node.label ?? node.text ?? "";
  const style = {
    strokeStyle: node.style || "solid",
    strokeWidth: node.strokeWidth ?? 2,
    opacity: node.opacity ?? 100,
    roughness: node.roughness ?? 1,
  };
  if (shape === "text") {
    const t = textEl(label, x, y, { fontSize: node.fontSize ?? 20, color: node.color ? colors(node.color)[0] : "#1e1e1e" });
    return [t];
  }
  if (shape === "highlight") {
    const [, hl] = colors(node.color || "yellow");
    return [base("rectangle", x, y, w, h, { strokeColor: "transparent", backgroundColor: node.color && !PALETTE[node.color] ? node.color : hl === "#ffec99" ? "#ffd43b" : hl, opacity: node.opacity ?? 35, roughness: 0, roundness: { type: 3 } })];
  }
  if (shape === "sticky") {
    const [st, bg] = colors(node.color || "yellow");
    const card = base("rectangle", x, y, w, h, { strokeColor: st, backgroundColor: bg === "#ffec99" ? "#fff3bf" : bg, roughness: 0, strokeWidth: 1, roundness: { type: 3 } });
    return label ? [card, labelFor(card, label, { fontSize: node.fontSize ?? 20, valign: "top" })] : [card];
  }
  if (shape === "frame") {
    return [base("frame", x, y, w, h, { name: label || null, strokeColor: "#bbb", roughness: 0, strokeWidth: 2 })];
  }
  const type = ["rectangle", "ellipse", "diamond"].includes(shape) ? shape : "rectangle";
  const el = base(type, x, y, w, h, {
    strokeColor: stroke,
    backgroundColor: node.fill ? colors(node.fill)[1] : node.color ? fill : "transparent",
    roundness: type === "rectangle" ? { type: 3 } : type === "diamond" ? { type: 2 } : null,
    ...style,
  });
  return label ? [el, labelFor(el, label, { fontSize: node.fontSize ?? 20 })] : [el];
}

function buildArrow(all, from, to, edge = {}) {
  const fb = bbox(from), tb = bbox(to);
  const s = edgePoint(fb, center(tb), 6, from.type);
  const e = edgePoint(tb, center(fb), 6, to.type);
  const [stroke] = colors(edge.color, ["#1e1e1e"]);
  const heads = edge.arrow || "end";
  const arrow = base("arrow", s.x, s.y, Math.abs(e.x - s.x), Math.abs(e.y - s.y), {
    strokeColor: stroke,
    strokeStyle: edge.style || "solid",
    strokeWidth: edge.strokeWidth ?? 2,
    roundness: { type: 2 },
    points: [[0, 0], [Math.round(e.x - s.x), Math.round(e.y - s.y)]],
    lastCommittedPoint: null,
    startBinding: { elementId: from.id, focus: 0, gap: 6 },
    endBinding: { elementId: to.id, focus: 0, gap: 6 },
    startArrowhead: heads === "both" ? "arrow" : null,
    endArrowhead: heads === "none" ? null : "arrow",
    elbowed: false,
  });
  from.boundElements = [...(from.boundElements || []), { id: arrow.id, type: "arrow" }];
  to.boundElements = [...(to.boundElements || []), { id: arrow.id, type: "arrow" }];
  touch(from), touch(to);
  const out = [arrow];
  if (edge.label) {
    const mid = { x: (s.x + e.x) / 2, y: (s.y + e.y) / 2 };
    const sz = textSize(edge.label, 16);
    const t = textEl(edge.label, mid.x - sz.w / 2, mid.y - sz.h / 2, { fontSize: 16, containerId: arrow.id, align: "center", valign: "middle" });
    arrow.boundElements.push({ id: t.id, type: "text" });
    out.push(t);
  }
  return out;
}

function touch(el) {
  el.version = (el.version || 1) + 1;
  el.versionNonce = nonce();
  el.updated = Date.now();
  return el;
}

/** Re-points straight arrows that are bound to elements that moved or changed size. */
function rerouteArrows(elements, changedIds) {
  const byId = new Map(elements.map((e) => [e.id, e]));
  for (const a of elements) {
    if (a.type !== "arrow") continue;
    const sId = a.startBinding?.elementId, eId = a.endBinding?.elementId;
    if (!changedIds.has(sId) && !changedIds.has(eId) && !changedIds.has(a.id)) continue;
    const pts = a.points || [[0, 0], [a.width, a.height]];
    const absS = { x: a.x + pts[0][0], y: a.y + pts[0][1] };
    const absE = { x: a.x + pts.at(-1)[0], y: a.y + pts.at(-1)[1] };
    const S = byId.get(sId), E = byId.get(eId);
    const sTarget = E ? center(bbox(E)) : absE, eTarget = S ? center(bbox(S)) : absS;
    const s = S ? edgePoint(bbox(S), sTarget, 6, S.type) : absS;
    const e = E ? edgePoint(bbox(E), eTarget, 6, E.type) : absE;
    a.x = Math.round(s.x), a.y = Math.round(s.y);
    a.points = [[0, 0], [Math.round(e.x - s.x), Math.round(e.y - s.y)]];
    a.width = Math.abs(a.points[1][0]), a.height = Math.abs(a.points[1][1]);
    touch(a);
    for (const b of a.boundElements || []) {
      const t = byId.get(b.id);
      if (t?.type === "text") {
        t.x = Math.round((s.x + e.x) / 2 - t.width / 2), t.y = Math.round((s.y + e.y) / 2 - t.height / 2);
        touch(t);
      }
    }
  }
}

// ------------------------------------------------------------------ layout

/** Layered layout: each node goes one rank after its furthest parent. */
function autoLayout(nodes, edges, direction = "down") {
  const ids = nodes.map((n) => n.id);
  const rank = Object.fromEntries(ids.map((id) => [id, 0]));
  const local = edges.filter((e) => rank[e.from] !== undefined && rank[e.to] !== undefined && e.from !== e.to);
  for (let pass = 0; pass < ids.length; pass++) {
    let changed = false;
    for (const e of local) if (rank[e.to] < rank[e.from] + 1 && rank[e.from] + 1 < ids.length) (rank[e.to] = rank[e.from] + 1), (changed = true);
    if (!changed) break;
  }
  const rows = [];
  for (const n of nodes) (rows[rank[n.id]] ||= []).push(n);
  const across = direction === "right" ? "h" : "w";
  const along = direction === "right" ? "w" : "h";
  const GAP_ACROSS = 60, GAP_ALONG = 110;
  const rowSpan = rows.map((r) => (r || []).reduce((s, n) => s + n.size[across], 0) + GAP_ACROSS * ((r || []).length - 1));
  const widest = Math.max(...rowSpan, 0);
  let offAlong = 0;
  const pos = {};
  rows.forEach((r = [], i) => {
    let offAcross = (widest - rowSpan[i]) / 2;
    const depth = Math.max(...r.map((n) => n.size[along]), 0);
    for (const n of r) {
      const centreAlong = offAlong + (depth - n.size[along]) / 2;
      pos[n.id] = direction === "right" ? { x: centreAlong, y: offAcross } : { x: offAcross, y: centreAlong };
      offAcross += n.size[across] + GAP_ACROSS;
    }
    offAlong += depth + GAP_ALONG;
  });
  return pos;
}

// ------------------------------------------------------------------ commands

function cmdWhere() {
  const { dir, source } = projectsFolder();
  console.log(`${dir}  (from ${source})`);
}

function cmdSetFolder(p) {
  if (!p) die("Usage: set-folder <path>");
  const dir = path.resolve(p.replace(/^~(?=$|\/)/, os.homedir()));
  if (!fs.existsSync(dir)) die(`Folder does not exist: ${dir}`);
  fs.writeFileSync(CONFIG, JSON.stringify({ ...readConfig(), dir }, null, 2) + "\n");
  console.log(`Projects folder set to ${dir}`);
}

function ago(ms) {
  const s = Math.round((Date.now() - ms) / 1000);
  return s < 60 ? `${s}s ago` : s < 3600 ? `${Math.round(s / 60)} min ago` : s < 86400 ? `${Math.round(s / 3600)} h ago` : new Date(ms).toISOString().slice(0, 16).replace("T", " ");
}

function cmdList() {
  const { dir } = projectsFolder();
  console.log(`Projects folder: ${dir}\n`);
  const projects = fs.readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory() && !d.name.startsWith(".")).map((d) => d.name).sort();
  if (!projects.length) console.log("(no projects yet)");
  for (const p of projects) {
    console.log(`${p}/`);
    for (const b of listBoards(path.join(dir, p))) {
      const f = path.join(dir, p, b + EXT);
      let n = "?";
      try { n = loadDoc(f).elements.length; } catch { /* unreadable */ }
      const hasPreview = fs.existsSync(path.join(dir, p, b + PREVIEW));
      console.log(`  ${b}  — ${n} elements, edited ${ago(fs.statSync(f).mtimeMs)}${hasPreview ? "" : ", no preview yet"}`);
    }
  }
}

function cmdNew(ref) {
  const p = boardPaths(ref, { create: true });
  if (fs.existsSync(p.file)) die(`Board already exists: ${p.file}`);
  fs.mkdirSync(p.projectDir, { recursive: true });
  saveDoc(p.file, emptyDoc());
  console.log(`Created ${p.project}/${p.board}\n${p.file}`);
}

/** Classifies every element into screenshots, markups, notes and diagram parts. */
function describe(doc, p) {
  const els = doc.elements;
  const byId = new Map(els.map((e) => [e.id, e]));
  const textOf = (e) => (e.boundElements || []).map((b) => byId.get(b.id)).filter((t) => t?.type === "text").map((t) => t.text).join(" ");

  const images = els.filter((e) => e.type === "image").sort((a, b) => a.y - b.y || a.x - b.x).map((e, i) => {
    const meta = doc.fileIndex[e.fileId];
    const file = meta ? path.join(p.projectDir, meta.path) : null;
    const natural = file && fs.existsSync(file) ? imageSize(file) : null;
    return { ref: `Image ${i + 1}`, id: e.id, file, natural, box: bbox(e) };
  });

  const where = (b) => {
    let best = null, bestArea = 0;
    for (const img of images) {
      const a = overlap(b, img.box);
      if (a > bestArea) (best = img), (bestArea = a);
    }
    const c = center(b);
    if (!best) {
      const hit = images.find((img) => inside(c, img.box, 4));
      if (!hit) return null;
      best = hit;
    }
    const r = (v, o, s) => Math.round(((v - o) / s) * 100);
    const ib = best.box;
    const pct = { x1: r(b.x, ib.x, ib.w), y1: r(b.y, ib.y, ib.h), x2: r(b.x + b.w, ib.x, ib.w), y2: r(b.y + b.h, ib.y, ib.h) };
    const px = best.natural && {
      x1: Math.round(((b.x - ib.x) / ib.w) * best.natural.w), y1: Math.round(((b.y - ib.y) / ib.h) * best.natural.h),
      x2: Math.round(((b.x + b.w - ib.x) / ib.w) * best.natural.w), y2: Math.round(((b.y + b.h - ib.y) / ib.h) * best.natural.h),
    };
    return { image: best.ref, pct, px };
  };
  const pointOn = (pt) => {
    const img = images.find((i) => inside(pt, i.box));
    if (!img) return null;
    return { image: img.ref, xPct: Math.round(((pt.x - img.box.x) / img.box.w) * 100), yPct: Math.round(((pt.y - img.box.y) / img.box.h) * 100) };
  };
  // the smallest thing (note, shape or markup, not the screenshot itself) at a point
  const shapeAt = (pt, skip) =>
    els
      .filter((e) => e.id !== skip && e.type !== "arrow" && e.type !== "image" && !(e.type === "text" && e.containerId) && inside(pt, bbox(e), 16))
      .sort((a, b) => bbox(a).w * bbox(a).h - bbox(b).w * bbox(b).h)[0];

  const markups = [], notes = [], nodes = [], arrows = [], sketches = [];
  const arrowEls = [];
  for (const e of els) {
    if (e.type === "image" || (e.type === "text" && e.containerId)) continue;
    if (e.type === "arrow" || (e.type === "line" && (e.startArrowhead || e.endArrowhead))) { arrowEls.push(e); continue; }
    const b = bbox(e);
    const base = { id: e.id, at: where(b), box: { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.w), h: Math.round(b.h) } };
    const label = textOf(e);
    const translucent = (e.opacity ?? 100) < 100;
    if (e.type === "text") { notes.push({ ...base, kind: "text", text: e.text, color: colorName(e.strokeColor) }); continue; }
    if (e.type === "freedraw") {
      if (translucent) markups.push({ ...base, kind: "highlighter stroke", color: colorName(e.strokeColor) });
      else if (isRed(e.strokeColor)) markups.push({ ...base, kind: "red marker stroke", hint: b.w > 30 && b.h > 30 ? "probably circles or underlines something" : "short mark" });
      else sketches.push({ ...base, kind: "pen stroke", color: colorName(e.strokeColor) });
      continue;
    }
    if (["rectangle", "ellipse", "diamond", "line"].includes(e.type)) {
      const filled = e.backgroundColor && e.backgroundColor !== "transparent";
      if (translucent && filled && !label) { markups.push({ ...base, kind: "highlight box", color: colorName(e.backgroundColor) }); continue; }
      // note cards: filled, smooth (roughness 0) rectangles with text; yellow ones may also be drawn by hand
      const card = filled && label && e.type === "rectangle" && ((e.roughness ?? 1) === 0 || isYellowish(e.backgroundColor));
      if (card) { notes.push({ ...base, kind: isYellowish(e.backgroundColor) ? "sticky note" : `${colorName(e.backgroundColor)} sticky note`, text: label }); continue; }
      if (base.at && !filled && !label) { markups.push({ ...base, kind: `${isRed(e.strokeColor) ? "red " : ""}${e.type === "line" ? "line" : `outline ${e.type}`}`, color: colorName(e.strokeColor) }); continue; }
      nodes.push({ ...base, kind: e.type, label: label || undefined, color: colorName(e.strokeColor), fill: colorName(e.backgroundColor) });
      continue;
    }
    if (e.type === "frame") { nodes.push({ ...base, kind: "frame", label: e.name || undefined }); continue; }
    sketches.push({ ...base, kind: e.type });
  }

  // arrows last, so their ends can be named the same way as the lists above
  const kindById = new Map([...markups, ...notes, ...nodes, ...sketches].map((x) => [x.id, x]));
  const oneLine = (s) => String(s).replace(/\n/g, " / ");
  const nameOf = (x) => {
    if (!x || x.type === "image") return null; // for screenshots, say where on the image instead
    const k = kindById.get(x.id);
    const txt = k?.text ?? k?.label ?? textOf(x);
    return `${k?.kind ?? x.type}${txt ? ` "${oneLine(txt)}"` : ""} [${x.id}]`;
  };
  const spot = (pt) => { const o = pointOn(pt); return o ? `${o.image} @ ${o.xPct}% across, ${o.yPct}% down` : "empty space"; };
  for (const e of arrowEls) {
    const pts = e.points || [[0, 0], [e.width, e.height]];
    const s = { x: e.x + pts[0][0], y: e.y + pts[0][1] }, t = { x: e.x + pts.at(-1)[0], y: e.y + pts.at(-1)[1] };
    const head = e.endArrowhead || !e.startArrowhead ? t : s, tail = head === t ? s : t;
    const fromEl = byId.get((head === t ? e.startBinding : e.endBinding)?.elementId) || shapeAt(tail, e.id);
    const toEl = byId.get((head === t ? e.endBinding : e.startBinding)?.elementId) || shapeAt(head, e.id);
    const onImage = pointOn(head);
    arrows.push({
      id: e.id, label: textOf(e) || undefined, color: colorName(e.strokeColor), style: e.strokeStyle,
      from: nameOf(fromEl) || spot(tail),
      to: (nameOf(toEl) ? nameOf(toEl) + (onImage ? ` on ${spot(head)}` : "") : spot(head)),
      pointsAt: onImage || undefined,
    });
  }

  let preview = null;
  if (fs.existsSync(p.preview)) {
    const pm = fs.statSync(p.preview).mtimeMs, bm = fs.statSync(p.file).mtimeMs;
    preview = { file: p.preview, updated: ago(pm), stale: pm + 1500 < bm };
  }
  return { board: `${p.project}/${p.board}`, file: p.file, preview, bounds: contentBounds(els), images, markups, notes, arrows, nodes, sketches };
}

function cmdRead(ref) {
  const p = boardPaths(ref);
  const d = describe(loadDoc(p.file), p);
  if (flags.json) return console.log(JSON.stringify(d, null, 2));
  const at = (x) => !x.at ? "" : ` on ${x.at.image} at ${x.at.pct.x1}–${x.at.pct.x2}% across, ${x.at.pct.y1}–${x.at.pct.y2}% down` + (x.at.px ? ` (px ${x.at.px.x1},${x.at.px.y1} → ${x.at.px.x2},${x.at.px.y2})` : "");
  const L = [];
  L.push(`Board: ${d.board}`, `File: ${d.file}`);
  L.push(d.preview ? `Preview: ${d.preview.file} (updated ${d.preview.updated}${d.preview.stale ? "; OLDER than the board, open it in SketchNotes to refresh" : ""})` : "Preview: none yet (it is written when the board is open in SketchNotes)");
  if (d.bounds) L.push(`Content area: x ${Math.round(d.bounds.x)}…${Math.round(d.bounds.x + d.bounds.w)}, y ${Math.round(d.bounds.y)}…${Math.round(d.bounds.y + d.bounds.h)} (scene units)`);
  L.push("", `Screenshots / images (${d.images.length}):`);
  for (const i of d.images) L.push(`  ${i.ref} [${i.id}] ${i.file ?? "(file missing)"}${i.natural ? ` ${i.natural.w}×${i.natural.h}px` : ""}, on board at x ${Math.round(i.box.x)}, y ${Math.round(i.box.y)}, ${Math.round(i.box.w)}×${Math.round(i.box.h)}`);
  L.push("", `Markups (${d.markups.length}):`);
  for (const m of d.markups) L.push(`  - ${m.kind}${m.color && m.color !== "none" && !m.kind.includes(m.color) ? ` (${m.color})` : ""}${at(m) || ` at x ${m.box.x}, y ${m.box.y}, ${m.box.w}×${m.box.h}`}${m.hint ? `, ${m.hint}` : ""} [${m.id}]`);
  L.push("", `Notes (${d.notes.length}):`);
  for (const n of d.notes) L.push(`  - ${n.kind}: "${n.text.replace(/\n/g, " / ")}"${at(n) || ` at x ${n.box.x}, y ${n.box.y}`} [${n.id}]`);
  L.push("", `Arrows (${d.arrows.length}):`);
  for (const a of d.arrows) L.push(`  - ${a.from} → ${a.to}${a.label ? ` "${a.label}"` : ""}${a.color !== "black" ? ` (${a.color})` : ""}${a.style && a.style !== "solid" ? ` ${a.style}` : ""} [${a.id}]`);
  L.push("", `Shapes / diagram nodes (${d.nodes.length}):`);
  for (const n of d.nodes) L.push(`  - ${n.kind}${n.label ? ` "${n.label.replace(/\n/g, " / ")}"` : ""} at x ${n.box.x}, y ${n.box.y}, ${n.box.w}×${n.box.h}${n.color && n.color !== "black" ? `, ${n.color}` : ""}${at(n)} [${n.id}]`);
  if (d.sketches.length) {
    L.push("", `Freehand sketches / handwriting (${d.sketches.length} strokes, look at the preview to read them):`);
    const groups = {};
    for (const s of d.sketches) (groups[s.at?.image ?? "board"] ||= []).push(s);
    for (const [k, v] of Object.entries(groups)) {
      const b = contentBounds(v.map((s) => ({ x: s.box.x, y: s.box.y, width: s.box.w, height: s.box.h })));
      L.push(`  - ${v.length} stroke(s) ${k === "board" ? "on the board" : `on ${k}`} around x ${Math.round(b.x)}, y ${Math.round(b.y)}, ${Math.round(b.w)}×${Math.round(b.h)}`);
    }
  }
  console.log(L.join("\n"));
}

function cmdDraw(ref, src) {
  const p = boardPaths(ref);
  const spec = readInput(src);
  const doc = loadDoc(p.file);
  const els = doc.elements;
  const byId = new Map(els.map((e) => [e.id, e]));
  const nodes = (spec.nodes || []).map((n, i) => ({ ...n, id: String(n.id ?? `n${i + 1}`) }));
  const edges = spec.edges || [];
  for (const n of nodes) n.size = nodeSize(n);

  // where the new content goes
  const anchorOf = (id) => {
    const a = byId.get(id);
    if (!a) die(`relativeTo/near: no element with id "${id}" on this board.`);
    return bbox(a);
  };
  const positioned = nodes.some((n) => n.x !== undefined && n.y !== undefined);
  let pos = {};
  if (!positioned) {
    pos = autoLayout(nodes, edges, spec.direction === "right" ? "right" : "down");
    const layoutW = Math.max(0, ...nodes.map((n) => pos[n.id].x + n.size.w)), layoutH = Math.max(0, ...nodes.map((n) => pos[n.id].y + n.size.h));
    let ox = 0, oy = 0;
    const at = spec.at ?? "right";
    if (typeof at === "object" && at.near) {
      const b = anchorOf(at.near);
      if (at.side === "below") (ox = b.x), (oy = b.y + b.h + 80);
      else (ox = b.x + b.w + 80), (oy = b.y);
    } else if (typeof at === "object" && Number.isFinite(at.x)) (ox = at.x), (oy = at.y);
    else {
      const b = contentBounds(els);
      if (b) at === "below" ? ((ox = b.x), (oy = b.y + b.h + 120)) : ((ox = b.x + b.w + 120), (oy = b.y));
    }
    if (spec.title) oy += 60;
    for (const id in pos) (pos[id].x += ox), (pos[id].y += oy);
    spec._origin = { x: ox, y: oy - (spec.title ? 60 : 0), w: layoutW, h: layoutH };
  } else {
    for (const n of nodes) {
      const off = n.relativeTo ? anchorOf(n.relativeTo) : { x: 0, y: 0 };
      pos[n.id] = { x: off.x + (n.x ?? 0), y: off.y + (n.y ?? 0) };
    }
  }

  const added = [];
  const idMap = {};
  const taken = new Set(els.map((e) => e.id));
  for (const n of nodes) {
    const { x, y } = pos[n.id];
    const built = buildNode(n, x, y, n.size.w, n.size.h);
    // keep the spec's id when it is free, so later edits can refer to it
    let id = n.id;
    for (let k = 2; taken.has(id); k++) id = `${n.id}-${k}`;
    const main = built[0];
    for (const t of built.slice(1)) if (t.containerId === main.id) t.containerId = id;
    main.id = id;
    taken.add(id);
    idMap[n.id] = id;
    added.push(...built);
  }
  if (spec.title) {
    const o = spec._origin;
    const t = textEl(spec.title, o.x, o.y, { fontSize: 28 });
    added.push(t);
  }
  const all = [...els, ...added];
  const find = (ref) => all.find((e) => e.id === (idMap[ref] ?? ref));
  for (const e of edges) {
    const from = find(e.from), to = find(e.to);
    if (!from || !to) die(`Edge ${e.from} → ${e.to}: unknown node id.`);
    const arrow = buildArrow(all, from, to, e);
    added.push(...arrow);
    all.push(...arrow);
  }
  saveDoc(p.file, { ...doc, elements: all });
  const shown = nodes.map((n) => `${n.id}${idMap[n.id] !== n.id ? `→${idMap[n.id]}` : ""}`).join(", ");
  console.log(`Added ${added.length} elements to ${p.project}/${p.board} (nodes: ${shown || "none"}; ${edges.length} arrows).`);
  console.log("If the board is open in SketchNotes it updates within ~2 seconds.");
}

function cmdEdit(ref, src) {
  const p = boardPaths(ref);
  let ops = readInput(src);
  if (!Array.isArray(ops)) ops = ops.ops ?? [ops];
  const doc = loadDoc(p.file);
  let els = doc.elements;
  const byId = () => new Map(els.map((e) => [e.id, e]));
  const changed = new Set();
  const log = [];
  for (const op of ops) {
    const map = byId();
    const el = map.get(op.id);
    if (!el) die(`No element with id "${op.id}". Run \`read\` to see ids.`);
    const kind = op.op || (op.delete ? "delete" : "update");
    if (kind === "delete") {
      const gone = new Set([el.id, ...(el.boundElements || []).filter((b) => b.type === "text").map((b) => b.id)]);
      if (op.keepArrows !== true) for (const b of el.boundElements || []) if (b.type === "arrow") gone.add(b.id);
      for (const id of [...gone]) for (const b of map.get(id)?.boundElements || []) if (b.type === "text") gone.add(b.id);
      els = els.filter((e) => !gone.has(e.id));
      for (const e of els) {
        const before = (e.boundElements || []).length;
        e.boundElements = (e.boundElements || []).filter((b) => !gone.has(b.id));
        if (e.startBinding && gone.has(e.startBinding.elementId)) (e.startBinding = null), touch(e);
        if (e.endBinding && gone.has(e.endBinding.elementId)) (e.endBinding = null), touch(e);
        if (e.boundElements.length !== before) touch(e);
      }
      log.push(`deleted ${el.id} (+${gone.size - 1} attached)`);
      continue;
    }
    // update
    const newText = op.label ?? op.text;
    if (newText !== undefined) {
      const t = el.type === "text" ? el : (el.boundElements || []).map((b) => map.get(b.id)).find((x) => x?.type === "text");
      if (t) {
        Object.assign(t, { text: String(newText), originalText: String(newText), customData: { ...(t.customData || {}), needsMeasure: true } });
        const fs = t.fontSize ?? 20, sz = textSize(newText, fs);
        Object.assign(t, { width: Math.round(sz.w), height: Math.round(sz.h) });
        // grow the shape (around its centre) so the new label fits
        if (t !== el && ["rectangle", "ellipse", "diamond"].includes(el.type) && op.w === undefined && op.h === undefined) {
          const need = nodeSize({ label: String(newText), shape: el.type, fontSize: fs });
          const w = Math.max(el.width, need.w), h = Math.max(el.height, need.h);
          if (w !== el.width || h !== el.height) {
            el.x -= (w - el.width) / 2, el.y -= (h - el.height) / 2;
            el.width = Math.round(w), el.height = Math.round(h);
            changed.add(el.id);
          }
          if (t.verticalAlign !== "top") (t.x = Math.round(el.x + (el.width - t.width) / 2)), (t.y = Math.round(el.y + (el.height - t.height) / 2));
        }
        touch(t);
      } else if (["rectangle", "ellipse", "diamond", "arrow"].includes(el.type)) {
        const lbl = labelFor(el, String(newText), { fontSize: 20 });
        els.push(lbl);
      }
    }
    if (op.color) {
      const [s, f] = colors(op.color);
      el.strokeColor = s;
      if (el.backgroundColor !== "transparent" || op.fill) el.backgroundColor = f;
    }
    if (op.fill) el.backgroundColor = colors(op.fill)[1];
    for (const k of ["strokeColor", "backgroundColor", "opacity", "strokeStyle", "strokeWidth", "fontSize"]) if (op[k] !== undefined) el[k] = op[k];
    const dx = op.moveBy?.x ?? (op.x !== undefined ? op.x - el.x : 0);
    const dy = op.moveBy?.y ?? (op.y !== undefined ? op.y - el.y : 0);
    if (dx || dy || op.w !== undefined || op.h !== undefined) {
      el.x += dx, el.y += dy;
      if (op.w !== undefined) el.width = op.w;
      if (op.h !== undefined) el.height = op.h;
      for (const b of el.boundElements || []) {
        const t = map.get(b.id);
        if (t?.type === "text") {
          t.x += dx, t.y += dy;
          if (op.w !== undefined || op.h !== undefined) (t.x = el.x + (el.width - t.width) / 2), (t.y = el.y + (el.height - t.height) / 2);
          touch(t);
        }
      }
      changed.add(el.id);
    }
    touch(el);
    log.push(`updated ${el.id}`);
  }
  rerouteArrows(els, changed);
  saveDoc(p.file, { ...doc, elements: els });
  console.log(`${log.join("\n")}\nSaved ${p.project}/${p.board}.`);
}

function cmdAddImage(ref, src) {
  const p = boardPaths(ref);
  if (!src || !fs.existsSync(src)) die("Usage: add-image <Project/Board> <image.png|jpg>");
  const size = imageSize(src);
  if (!size) die("Only PNG, JPEG and WebP images are supported.");
  const ext = path.extname(src).toLowerCase().replace(".jpeg", ".jpg") || ".png";
  const mime = { ".png": "image/png", ".jpg": "image/jpeg", ".webp": "image/webp" }[ext];
  if (!mime) die("Only PNG, JPEG and WebP images are supported.");
  const doc = loadDoc(p.file);
  const fileId = crypto.createHash("sha1").update(fs.readFileSync(src)).digest("hex");
  fs.mkdirSync(path.join(p.projectDir, "files"), { recursive: true });
  fs.copyFileSync(src, path.join(p.projectDir, "files", fileId + ext));
  doc.fileIndex[fileId] = { mimeType: mime, path: `files/${fileId}${ext}`, created: Date.now() };
  const w = Number(flags.width) || Math.min(size.w, 1200);
  const h = Math.round((w / size.w) * size.h);
  const b = contentBounds(doc.elements);
  const x = flags.x !== undefined ? Number(flags.x) : b ? b.x + b.w + 120 : 0;
  const y = flags.y !== undefined ? Number(flags.y) : b ? b.y : 0;
  const img = base("image", x, y, w, h, { strokeColor: "transparent", fileId, status: "saved", scale: [1, 1], crop: null });
  doc.elements.push(img);
  saveDoc(p.file, doc);
  console.log(`Added image [${img.id}] at x ${Math.round(x)}, y ${Math.round(y)}, ${w}×${h} to ${p.project}/${p.board}.`);
}

const [cmd, a1, a2] = args;
switch (cmd) {
  case "where": cmdWhere(); break;
  case "set-folder": cmdSetFolder(a1); break;
  case "list": cmdList(); break;
  case "read": cmdRead(a1); break;
  case "new": cmdNew(a1); break;
  case "draw": cmdDraw(a1, a2); break;
  case "edit": cmdEdit(a1, a2); break;
  case "add-image": cmdAddImage(a1, a2); break;
  default: console.log(USAGE); process.exit(cmd ? 1 : 0);
}
