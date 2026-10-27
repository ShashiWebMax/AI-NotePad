// Turns a just-finished freehand stroke into a clean shape when it looks like one.
// The replacement is a single undo step, so Cmd/Ctrl+Z brings the raw stroke back.

import { CaptureUpdateAction } from "@excalidraw/excalidraw";
import { detectCaret, recognize, type Pt } from "./geometry";
import { arrowFromPoints, bindArrow, bindableAt, bump, toElements, type El } from "../scene";

const processed = new Set<string>();
let lastLinear: { id: string; t: number } | null = null;

export function handleStrokeEnd(api: any) {
  // let Excalidraw finalise the stroke first
  setTimeout(() => {
    try {
      run(api);
    } catch (e) {
      console.warn("Shape recognition failed", e);
    }
  }, 0);
}

function run(api: any) {
  const appState = api.getAppState();
  if (appState.newElement) return;
  const elements: El[] = [...api.getSceneElementsIncludingDeleted()];
  const stroke = [...elements].reverse().find((e) => !e.isDeleted);
  if (!stroke || stroke.type !== "freedraw" || processed.has(stroke.id)) return;
  processed.add(stroke.id);
  if (stroke.opacity < 100) return; // highlighter strokes stay freehand

  const pts: Pt[] = stroke.points.map((p: number[]) => ({ x: stroke.x + p[0], y: stroke.y + p[1] }));
  const deleteStroke = (list: El[]) => list.map((e) => (e.id === stroke.id ? bump(e, { isDeleted: true }) : e));

  // 1) A small "V" right after drawing a line adds an arrowhead to it
  const caret = detectCaret(pts);
  if (caret && caret.size < 80 && lastLinear && Date.now() - lastLinear.t < 10000) {
    const line = elements.find((e) => e.id === lastLinear!.id && !e.isDeleted);
    if (line) {
      const first = { x: line.x + line.points[0][0], y: line.y + line.points[0][1] };
      const lp = line.points[line.points.length - 1];
      const last = { x: line.x + lp[0], y: line.y + lp[1] };
      const reach = Math.max(24, caret.size * 0.9);
      const dEnd = Math.hypot(caret.apex.x - last.x, caret.apex.y - last.y);
      const dStart = Math.hypot(caret.apex.x - first.x, caret.apex.y - first.y);
      if (Math.min(dEnd, dStart) < reach) {
        const changes = dEnd <= dStart ? { endArrowhead: "arrow" } : { startArrowhead: "arrow" };
        const next = deleteStroke(elements).map((e) => (e.id === line.id ? bump(e, changes) : e));
        api.updateScene({ elements: next, captureUpdate: CaptureUpdateAction.IMMEDIATELY });
        return;
      }
    }
  }

  // 2) Recognise the stroke itself
  const r = recognize(pts);
  if (!r) return;

  const common = {
    strokeColor: stroke.strokeColor,
    strokeWidth: stroke.strokeWidth,
    opacity: stroke.opacity,
    roughness: appState.currentItemRoughness ?? 1,
    strokeStyle: "solid",
    backgroundColor: "transparent",
    fillStyle: appState.currentItemFillStyle ?? "solid",
  };
  const round = appState.currentItemRoundness === "round";

  let skeleton: any;
  if (r.kind === "line" || r.kind === "arrow") {
    // straight lines become arrows without heads, so they can connect shapes too
    skeleton = arrowFromPoints(r.points, {
      ...common,
      startArrowhead: null,
      endArrowhead: r.kind === "arrow" ? "arrow" : null,
      roundness: r.points.length > 2 ? { type: 2 } : null,
    });
  } else if (r.kind === "triangle") {
    const [a] = r.points;
    const rel = [...r.points, a].map((p) => [p.x - a.x, p.y - a.y]);
    const xs = rel.map((p) => p[0]), ys = rel.map((p) => p[1]);
    skeleton = {
      type: "line",
      x: a.x,
      y: a.y,
      points: rel,
      width: Math.max(...xs) - Math.min(...xs),
      height: Math.max(...ys) - Math.min(...ys),
      ...common,
      roundness: null,
    };
  } else {
    skeleton = {
      type: r.kind,
      x: r.x,
      y: r.y,
      width: r.w,
      height: r.h,
      ...common,
      roundness: round ? { type: r.kind === "rectangle" ? 3 : 2 } : null,
    };
  }

  const [created] = toElements([skeleton]);
  let next = [...deleteStroke(elements), created];

  if (created.type === "arrow") {
    const s = r.kind === "line" || r.kind === "arrow" ? r.points : [];
    const ignore = new Set([created.id, stroke.id]);
    const startEl = bindableAt(next, s[0], ignore);
    const endEl = bindableAt(next, s[s.length - 1], ignore);
    if ((startEl || endEl) && startEl?.id !== endEl?.id) {
      next = bindArrow(next, created.id, startEl?.id ?? null, endEl?.id ?? null);
    }
    lastLinear = { id: created.id, t: Date.now() };
  }

  api.updateScene({ elements: next, captureUpdate: CaptureUpdateAction.IMMEDIATELY });
}
