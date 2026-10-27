// Small helpers for working with Excalidraw scene elements.

import { convertToExcalidrawElements } from "@excalidraw/excalidraw";

export type El = any;
export type Box = { x: number; y: number; w: number; h: number };

const BINDABLE = new Set(["rectangle", "ellipse", "diamond", "image", "text", "frame", "embeddable", "iframe"]);

export const randomNonce = () => Math.floor(Math.random() * 2 ** 31);

/** Returns a modified copy of an element with a bumped version so Excalidraw re-renders it. */
export function bump(el: El, changes: Record<string, any>): El {
  return { ...el, ...changes, version: (el.version ?? 1) + 1, versionNonce: randomNonce(), updated: Date.now() };
}

export function elBox(el: El): Box {
  if (el.type === "arrow" || el.type === "line" || el.type === "freedraw") {
    const xs = el.points.map((p: number[]) => p[0] + el.x);
    const ys = el.points.map((p: number[]) => p[1] + el.y);
    const x = Math.min(...xs), y = Math.min(...ys);
    return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
  }
  return { x: el.x, y: el.y, w: el.width, h: el.height };
}

export const center = (b: Box) => ({ x: b.x + b.w / 2, y: b.y + b.h / 2 });

/** Smallest bindable element whose (padded) box contains the point. */
export function bindableAt(elements: readonly El[], p: { x: number; y: number }, ignore = new Set<string>(), pad = 14): El | null {
  let best: El | null = null;
  let bestArea = Infinity;
  for (const el of elements) {
    if (el.isDeleted || ignore.has(el.id) || !BINDABLE.has(el.type) || el.locked) continue;
    if (el.type === "text" && el.containerId) continue;
    const b = elBox(el);
    if (p.x >= b.x - pad && p.x <= b.x + b.w + pad && p.y >= b.y - pad && p.y <= b.y + b.h + pad) {
      const area = b.w * b.h;
      if (area < bestArea) { best = el; bestArea = area; }
    }
  }
  return best;
}

/** Point on the edge of box b along the ray from its centre towards `toward`. */
export function edgePoint(b: Box, toward: { x: number; y: number }, gap = 6) {
  const c = center(b);
  const dx = toward.x - c.x, dy = toward.y - c.y;
  if (dx === 0 && dy === 0) return c;
  const sx = dx === 0 ? Infinity : (b.w / 2 + gap) / Math.abs(dx);
  const sy = dy === 0 ? Infinity : (b.h / 2 + gap) / Math.abs(dy);
  const s = Math.min(sx, sy);
  return { x: c.x + dx * s, y: c.y + dy * s };
}

/**
 * Binds an arrow's start/end to target elements. Returns the updated list of elements
 * (arrow + targets replaced). Excalidraw keeps bound arrows attached when targets move.
 */
export function bindArrow(all: El[], arrowId: string, startId: string | null, endId: string | null): El[] {
  const byId = new Map(all.map((e) => [e.id, e]));
  let arrow = byId.get(arrowId);
  if (!arrow) return all;
  const patch: Record<string, El> = {};
  const link = (targetId: string | null, which: "startBinding" | "endBinding") => {
    if (!targetId) return;
    const t = patch[targetId] ?? byId.get(targetId);
    if (!t || t.isDeleted) return;
    arrow = { ...arrow, [which]: { elementId: t.id, focus: 0, gap: 6 } };
    const bound = (t.boundElements || []).filter((b: El) => b.id !== arrowId);
    patch[targetId] = bump(t, { boundElements: [...bound, { id: arrowId, type: "arrow" }] });
  };
  link(startId, "startBinding");
  link(endId, "endBinding");
  patch[arrowId] = bump(arrow, {});
  return all.map((e) => patch[e.id] ?? e);
}

/** Creates an arrow skeleton from absolute scene points. */
export function arrowFromPoints(points: { x: number; y: number }[], props: Record<string, any>) {
  const x = points[0].x, y = points[0].y;
  return {
    type: "arrow" as const,
    x,
    y,
    points: points.map((p) => [p.x - x, p.y - y]),
    ...props,
  };
}

export function toElements(skeletons: any[]): El[] {
  return convertToExcalidrawElements(skeletons as any, { regenerateIds: false });
}
