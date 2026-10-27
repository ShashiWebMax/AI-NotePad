// Local-folder storage using the browser's File System Access API.
//
// Layout on disk:
//   <workspace>/
//     <Project A>/
//       Board 1.excalidraw      <- standard Excalidraw JSON (images stored separately)
//       files/<fileId>.png      <- pasted / dropped / AI-generated images
//       exports/                <- AI notes (.md) and exported PNGs
//     <Project B>/...
//
// Browsers without showDirectoryPicker (Safari, Firefox) fall back to the
// origin-private file system, which uses the same handle API but is not a
// folder you can see in Finder.

type Dir = FileSystemDirectoryHandle;

export const BOARD_EXT = ".excalidraw";

export interface ProjectInfo {
  name: string;
  handle: Dir;
  boards: string[]; // board names without extension
}

export interface LoadedBoard {
  elements: any[];
  appState: Record<string, any>;
  files: Record<string, any>;
}

declare global {
  interface Window {
    showDirectoryPicker?: (opts?: { mode?: "read" | "readwrite"; id?: string }) => Promise<Dir>;
  }
}

export const supportsFolderPicker = () => typeof window.showDirectoryPicker === "function";

// ---- Tiny IndexedDB key-value store for remembering the workspace handle ----

function idb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open("sketchnotes", 1);
    req.onupgradeneeded = () => req.result.createObjectStore("kv");
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function kvSet(key: string, value: unknown) {
  const db = await idb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction("kv", "readwrite");
    tx.objectStore("kv").put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function kvGet<T>(key: string): Promise<T | undefined> {
  const db = await idb();
  return new Promise((resolve, reject) => {
    const req = db.transaction("kv").objectStore("kv").get(key);
    req.onsuccess = () => resolve(req.result as T);
    req.onerror = () => reject(req.error);
  });
}

// ---- Workspace ----

export type WorkspaceKind = "folder" | "browser";

export async function pickFolderWorkspace(): Promise<Dir> {
  const handle = await window.showDirectoryPicker!({ mode: "readwrite", id: "sketchnotes" });
  await kvSet("workspace", { kind: "folder", handle });
  return handle;
}

export async function useBrowserWorkspace(): Promise<Dir> {
  const root = await navigator.storage.getDirectory();
  const handle = await root.getDirectoryHandle("SketchNotes", { create: true });
  await kvSet("workspace", { kind: "browser" });
  return handle;
}

/** Returns the last workspace, and whether we still need the user to click to re-grant access. */
export async function restoreWorkspace(): Promise<
  { handle: Dir; kind: WorkspaceKind; needsPermission: boolean } | null
> {
  try {
    const saved = await kvGet<{ kind: WorkspaceKind; handle?: Dir }>("workspace");
    if (!saved) return null;
    if (saved.kind === "browser") {
      const root = await navigator.storage.getDirectory();
      return { handle: await root.getDirectoryHandle("SketchNotes", { create: true }), kind: "browser", needsPermission: false };
    }
    if (!saved.handle) return null;
    const perm = await (saved.handle as any).queryPermission?.({ mode: "readwrite" });
    return { handle: saved.handle, kind: "folder", needsPermission: perm !== "granted" };
  } catch {
    return null;
  }
}

export async function requestPermission(handle: Dir): Promise<boolean> {
  const perm = await (handle as any).requestPermission?.({ mode: "readwrite" });
  return perm === "granted";
}

// ---- Projects & boards ----

const safeName = (name: string) => name.replace(/[\\/:*?"<>|]/g, "-").trim();

export async function listProjects(ws: Dir): Promise<ProjectInfo[]> {
  const out: ProjectInfo[] = [];
  for await (const entry of (ws as any).values() as AsyncIterable<FileSystemHandle>) {
    if (entry.kind !== "directory" || entry.name.startsWith(".")) continue;
    out.push({ name: entry.name, handle: entry as Dir, boards: await listBoards(entry as Dir) });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

export async function listBoards(project: Dir): Promise<string[]> {
  const boards: string[] = [];
  for await (const entry of (project as any).values() as AsyncIterable<FileSystemHandle>) {
    if (entry.kind === "file" && entry.name.endsWith(BOARD_EXT)) boards.push(entry.name.slice(0, -BOARD_EXT.length));
  }
  return boards.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
}

export async function createProject(ws: Dir, name: string): Promise<Dir> {
  const dir = await ws.getDirectoryHandle(safeName(name), { create: true });
  if ((await listBoards(dir)).length === 0) await createBoard(dir, "Board 1");
  return dir;
}

export async function createBoard(project: Dir, name: string): Promise<string> {
  const base = safeName(name) || "Board";
  const existing = new Set(await listBoards(project));
  let finalName = base;
  for (let i = 2; existing.has(finalName); i++) finalName = `${base} ${i}`;
  await writeText(project, finalName + BOARD_EXT, JSON.stringify(emptyBoard(), null, 2));
  return finalName;
}

export async function renameBoard(project: Dir, from: string, to: string): Promise<string> {
  const target = safeName(to);
  if (!target || target === from) return from;
  const text = await readText(project, from + BOARD_EXT);
  await writeText(project, target + BOARD_EXT, text);
  await project.removeEntry(from + BOARD_EXT);
  try {
    await project.removeEntry(from + PREVIEW_EXT); // the next save writes a new preview
  } catch {
    /* no preview yet */
  }
  return target;
}

/**
 * Deletes a board by moving it to <project>/.trash/, so it can still be recovered by hand.
 * Its preview is removed; images in files/ are kept, since the trashed board still uses them.
 */
export async function deleteBoard(project: Dir, board: string) {
  const text = await readText(project, board + BOARD_EXT);
  const trash = await project.getDirectoryHandle(".trash", { create: true });
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
  await writeText(trash, `${board} ${stamp}${BOARD_EXT}`, text);
  await project.removeEntry(board + BOARD_EXT);
  try {
    await project.removeEntry(board + PREVIEW_EXT);
  } catch {
    /* no preview */
  }
}

function emptyBoard() {
  return { type: "excalidraw", version: 2, source: "sketchnotes", elements: [], appState: {}, files: {}, fileIndex: {} };
}

async function readText(dir: Dir, name: string): Promise<string> {
  const fh = await dir.getFileHandle(name);
  return (await fh.getFile()).text();
}

async function writeText(dir: Dir, name: string, text: string | Blob) {
  const fh = await dir.getFileHandle(name, { create: true });
  const w = await (fh as any).createWritable();
  await w.write(text);
  await w.close();
}

const extFor = (mime: string) =>
  ({ "image/png": "png", "image/jpeg": "jpg", "image/gif": "gif", "image/webp": "webp", "image/svg+xml": "svg" })[mime] ?? "bin";

const blobToDataURL = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });

/** What the board file looked like when the app last read or wrote it. Used to spot edits made by other programs. */
export interface DiskStamp {
  lastModified: number;
  text: string;
}

type FileIndex = Record<string, { mimeType: string; path: string; created: number }>;

/** Reads the images listed in a board's fileIndex, skipping ids that are already loaded. */
export async function loadFiles(project: Dir, index: FileIndex, skip: Set<string> = new Set()) {
  const files: Record<string, any> = {};
  const ids = Object.keys(index).filter((id) => !skip.has(id));
  if (!ids.length) return files;
  let filesDir: Dir;
  try {
    filesDir = await project.getDirectoryHandle("files");
  } catch {
    return files; // no images yet
  }
  await Promise.all(
    ids.map(async (id) => {
      const meta = index[id];
      try {
        const blob = await (await filesDir.getFileHandle(meta.path.replace(/^files\//, ""))).getFile();
        files[id] = { id, mimeType: meta.mimeType, dataURL: await blobToDataURL(blob), created: meta.created };
      } catch {
        console.warn("Missing image file", meta.path);
      }
    }),
  );
  return files;
}

/** Last-modified time of a board file (cheap; used for polling). */
export async function boardModified(project: Dir, board: string): Promise<File> {
  return (await project.getFileHandle(board + BOARD_EXT)).getFile();
}

export async function loadBoard(project: Dir, board: string): Promise<LoadedBoard & { savedFileIds: Set<string>; stamp: DiskStamp }> {
  const file = await boardModified(project, board);
  const text = await file.text();
  const data = JSON.parse(text);
  const files: Record<string, any> = { ...(data.files || {}), ...(await loadFiles(project, data.fileIndex || {})) };
  const savedFileIds = new Set(Object.keys(data.fileIndex || {}).filter((id) => files[id]));
  return {
    elements: data.elements || [],
    appState: data.appState || {},
    files,
    savedFileIds,
    stamp: { lastModified: file.lastModified, text },
  };
}

/** Parses a board file that another program changed. */
export function parseBoard(text: string): { elements: any[]; fileIndex: FileIndex } {
  const data = JSON.parse(text);
  return { elements: Array.isArray(data.elements) ? data.elements : [], fileIndex: data.fileIndex || {} };
}

export const PREVIEW_EXT = ".preview.png";

/** Writes <board>.preview.png next to the board so other tools (e.g. Claude) can see it. */
export async function savePreview(project: Dir, board: string, png: Blob) {
  await writeText(project, board + PREVIEW_EXT, png);
}

const PERSISTED_APPSTATE = ["viewBackgroundColor", "gridSize", "gridStep", "gridModeEnabled", "scrollX", "scrollY", "zoom", "theme"];

export async function saveBoard(
  project: Dir,
  board: string,
  elements: readonly any[],
  appState: Record<string, any>,
  files: Record<string, any>,
  savedFileIds: Set<string>,
) {
  const live = elements.filter((e) => !e.isDeleted);
  const usedIds = new Set(live.filter((e) => e.type === "image" && e.fileId).map((e) => e.fileId));
  const fileIndex: Record<string, { mimeType: string; path: string; created: number }> = {};
  let filesDir: Dir | null = null;
  for (const id of usedIds) {
    const f = files[id];
    if (!f?.dataURL) continue;
    const path = `files/${id}.${extFor(f.mimeType)}`;
    fileIndex[id] = { mimeType: f.mimeType, path, created: f.created ?? Date.now() };
    if (!savedFileIds.has(id)) {
      filesDir ??= await project.getDirectoryHandle("files", { create: true });
      const blob = await (await fetch(f.dataURL)).blob();
      await writeText(filesDir, `${id}.${extFor(f.mimeType)}`, blob);
      savedFileIds.add(id);
    }
  }
  const state: Record<string, any> = {};
  for (const k of PERSISTED_APPSTATE) if (appState[k] !== undefined) state[k] = appState[k];
  const doc = { type: "excalidraw", version: 2, source: "sketchnotes", elements: live, appState: state, files: {}, fileIndex };
  const text = JSON.stringify(doc);
  await writeText(project, board + BOARD_EXT, text);
  const stamp: DiskStamp = { lastModified: (await boardModified(project, board)).lastModified, text };
  return stamp;
}

/** Writes a file to <project>/exports/ and returns its relative path. */
export async function saveExport(project: Dir, filename: string, content: string | Blob): Promise<string> {
  const dir = await project.getDirectoryHandle("exports", { create: true });
  await writeText(dir, safeName(filename), content);
  return `exports/${safeName(filename)}`;
}
