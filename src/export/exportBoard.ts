// Exports the current board (or just the selection) as PDF, PNG or SVG and downloads it.

import { exportToBlob, exportToSvg, getCommonBounds } from "@excalidraw/excalidraw";
import { jpegToPdf } from "./pdf";
import { embedSinhalaInSvg } from "../fonts/sinhala";

export type ExportFormat = "pdf" | "png" | "svg";

const PADDING = 24;
const MAX_SIDE = 8000; // keep the canvas within browser limits on very large boards

function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

const safeFile = (name: string) => name.replace(/[\\/:*?"<>|]/g, "-").trim() || "board";

/** Returns the elements to export: the selection if there is one and `selectionOnly`, else the whole board. */
export function exportTargets(api: any, selectionOnly: boolean) {
  const all = api.getSceneElements();
  if (!selectionOnly) return all;
  const ids = api.getAppState().selectedElementIds || {};
  const picked = all.filter((e: any) => ids[e.id]);
  // include labels and other text bound to selected shapes
  const withBound = new Set(picked.map((e: any) => e.id));
  for (const e of all) if (e.containerId && withBound.has(e.containerId)) withBound.add(e.id);
  return all.filter((e: any) => withBound.has(e.id));
}

export async function exportBoard(api: any, board: string, format: ExportFormat, selectionOnly = false): Promise<string> {
  const elements = exportTargets(api, selectionOnly);
  if (!elements.length) throw new Error("There's nothing on the board to export yet.");
  const st = api.getAppState();
  const appState = {
    ...st,
    exportBackground: true,
    exportWithDarkMode: false,
    viewBackgroundColor: st.viewBackgroundColor || "#ffffff",
  };
  const files = api.getFiles();
  const name = safeFile(board) + (selectionOnly ? " (selection)" : "");

  if (format === "svg") {
    const svg = await exportToSvg({ elements, appState, files, exportPadding: PADDING });
    await embedSinhalaInSvg(svg);
    download(new Blob([svg.outerHTML], { type: "image/svg+xml" }), `${name}.svg`);
    return `${name}.svg`;
  }

  const [x1, y1, x2, y2] = getCommonBounds(elements);
  const longest = Math.max(x2 - x1, y2 - y1) + PADDING * 2;
  const scale = Math.max(0.25, Math.min(2, MAX_SIDE / longest));
  let size = { w: 0, h: 0, cssW: 0, cssH: 0 };
  const blob = await exportToBlob({
    elements,
    appState,
    files,
    exportPadding: PADDING,
    mimeType: format === "pdf" ? "image/jpeg" : "image/png",
    quality: 0.92,
    getDimensions: (w: number, h: number) => {
      size = { w: Math.round(w * scale), h: Math.round(h * scale), cssW: w, cssH: h };
      return { width: size.w, height: size.h, scale };
    },
  });

  if (format === "png") {
    download(blob, `${name}.png`);
    return `${name}.png`;
  }

  // PDF page in points (1/72 inch) at 96 css px per inch, so it prints at the size you see on screen
  const jpeg = new Uint8Array(await blob.arrayBuffer());
  download(jpegToPdf(jpeg, size.w, size.h, size.cssW * 0.75, size.cssH * 0.75), `${name}.pdf`);
  return `${name}.pdf`;
}
