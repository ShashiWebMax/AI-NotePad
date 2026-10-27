// Pure-geometry shape recognizer for freehand strokes.
//
// Approach: resample the stroke, then
//  - open strokes: test for a straight line, or a line with an arrowhead drawn in the same stroke
//  - closed strokes: normalise into a [-1,1] box and measure how well the points fit an
//    ellipse, rectangle, diamond or triangle template; the best fit under a threshold wins.

export type Pt = { x: number; y: number };

export type Recognized =
  | { kind: "line"; points: Pt[] }
  | { kind: "arrow"; points: Pt[] } // arrowhead at the last point
  | { kind: "ellipse" | "rectangle" | "diamond"; x: number; y: number; w: number; h: number }
  | { kind: "triangle"; points: Pt[] };

const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);

export function pathLength(pts: Pt[]) {
  let len = 0;
  for (let i = 1; i < pts.length; i++) len += dist(pts[i - 1], pts[i]);
  return len;
}

export function bbox(pts: Pt[]) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of pts) {
    minX = Math.min(minX, p.x); minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y);
  }
  return { minX, minY, maxX, maxY, w: maxX - minX, h: maxY - minY };
}

export function resample(pts: Pt[], n = 96): Pt[] {
  const total = pathLength(pts);
  if (total === 0 || pts.length < 2) return pts.slice();
  const step = total / (n - 1);
  const out: Pt[] = [pts[0]];
  let acc = 0;
  let prev = pts[0];
  for (let i = 1; i < pts.length; i++) {
    let cur = pts[i];
    let d = dist(prev, cur);
    while (acc + d >= step && d > 0) {
      const t = (step - acc) / d;
      const q = { x: prev.x + t * (cur.x - prev.x), y: prev.y + t * (cur.y - prev.y) };
      out.push(q);
      prev = q;
      d = dist(prev, cur);
      acc = 0;
    }
    acc += d;
    prev = cur;
  }
  if (out.length < n) out.push(pts[pts.length - 1]);
  return out;
}

function pointSegDist(p: Pt, a: Pt, b: Pt) {
  const l2 = (b.x - a.x) ** 2 + (b.y - a.y) ** 2;
  if (l2 === 0) return dist(p, a);
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) / l2));
  return dist(p, { x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y) });
}

/** Ramer–Douglas–Peucker simplification of an open polyline. */
export function rdp(pts: Pt[], eps: number): Pt[] {
  if (pts.length < 3) return pts.slice();
  let maxD = 0, idx = 0;
  for (let i = 1; i < pts.length - 1; i++) {
    const d = pointSegDist(pts[i], pts[0], pts[pts.length - 1]);
    if (d > maxD) { maxD = d; idx = i; }
  }
  if (maxD <= eps) return [pts[0], pts[pts.length - 1]];
  const left = rdp(pts.slice(0, idx + 1), eps);
  const right = rdp(pts.slice(idx), eps);
  return left.slice(0, -1).concat(right);
}

/** Corners of a closed stroke (no repeated end point). */
function closedCorners(pts: Pt[], eps: number): Pt[] {
  // split at the point farthest from the start so both halves are well-behaved
  let far = 0, farD = 0;
  pts.forEach((p, i) => { const d = dist(p, pts[0]); if (d > farD) { farD = d; far = i; } });
  const a = rdp(pts.slice(0, far + 1), eps);
  const b = rdp(pts.slice(far).concat([pts[0]]), eps);
  let corners = a.slice(0, -1).concat(b.slice(0, -1));
  // drop near-straight vertices and near-duplicates
  let changed = true;
  while (changed && corners.length > 3) {
    changed = false;
    for (let i = 0; i < corners.length; i++) {
      const p = corners[(i - 1 + corners.length) % corners.length];
      const c = corners[i];
      const n = corners[(i + 1) % corners.length];
      const ang = angleAt(p, c, n);
      if (ang > 150 || dist(p, c) < eps * 1.2) {
        corners.splice(i, 1);
        changed = true;
        break;
      }
    }
  }
  return corners;
}

/** Interior angle at b, in degrees. */
function angleAt(a: Pt, b: Pt, c: Pt) {
  const v1 = { x: a.x - b.x, y: a.y - b.y };
  const v2 = { x: c.x - b.x, y: c.y - b.y };
  const den = Math.hypot(v1.x, v1.y) * Math.hypot(v2.x, v2.y);
  if (den === 0) return 180;
  return (Math.acos(Math.max(-1, Math.min(1, (v1.x * v2.x + v1.y * v2.y) / den))) * 180) / Math.PI;
}

function snapAngle(a: Pt, b: Pt): Pt {
  const ang = Math.atan2(b.y - a.y, b.x - a.x);
  const deg = ((ang * 180) / Math.PI + 360) % 180;
  if (deg < 6 || deg > 174) return { x: b.x, y: a.y };
  if (Math.abs(deg - 90) < 6) return { x: a.x, y: b.y };
  return b;
}

export function recognize(raw: Pt[]): Recognized | null {
  if (raw.length < 4) return null;
  const pts = resample(raw);
  const box = bbox(pts);
  const diag = Math.hypot(box.w, box.h);
  if (diag < 18) return null;
  const len = pathLength(pts);
  const start = pts[0];
  const end = pts[pts.length - 1];

  // ---- Straight line
  if (dist(start, end) / len > 0.94) {
    return { kind: "line", points: [start, snapAngle(start, end)] };
  }

  // ---- Arrow drawn in one stroke: shaft, then the head scribbled around the tip
  const arrow = detectOneStrokeArrow(pts);
  if (arrow) return arrow;

  // ---- Closed shapes
  const gap = dist(start, end);
  const closed = gap < 0.22 * diag && len > 1.6 * diag;
  if (!closed) return null;
  if (Math.min(box.w, box.h) < 10 || Math.max(box.w, box.h) / Math.max(1, Math.min(box.w, box.h)) > 10) return null;

  const cx = box.minX + box.w / 2;
  const cy = box.minY + box.h / 2;
  const norm = pts.map((p) => ({ u: (p.x - cx) / (box.w / 2), v: (p.y - cy) / (box.h / 2) }));
  const mean = (f: (q: { u: number; v: number }) => number) => norm.reduce((s, q) => s + f(q), 0) / norm.length;

  const errors: { kind: "ellipse" | "rectangle" | "diamond" | "triangle"; err: number }[] = [
    { kind: "ellipse", err: mean((q) => Math.abs(Math.hypot(q.u, q.v) - 1)) },
    { kind: "rectangle", err: mean((q) => Math.abs(Math.max(Math.abs(q.u), Math.abs(q.v)) - 1)) },
    { kind: "diamond", err: mean((q) => Math.abs(Math.abs(q.u) + Math.abs(q.v) - 1) / Math.SQRT2) },
  ];

  const corners = closedCorners(pts, 0.09 * diag);
  if (corners.length === 3) {
    const tri = corners.map((c) => ({ u: (c.x - cx) / (box.w / 2), v: (c.y - cy) / (box.h / 2) }));
    const triErr = mean((q) =>
      Math.min(
        ...[0, 1, 2].map((i) =>
          pointSegDist({ x: q.u, y: q.v }, { x: tri[i].u, y: tri[i].v }, { x: tri[(i + 1) % 3].u, y: tri[(i + 1) % 3].v }),
        ),
      ),
    );
    errors.push({ kind: "triangle", err: triErr * 0.9 });
  }

  errors.sort((a, b) => a.err - b.err);
  const best = errors[0];
  if (best.err > 0.17) return null;

  if (best.kind === "triangle") return { kind: "triangle", points: corners };

  // snap near-square boxes to squares / circles
  let { w, h } = box;
  let x = box.minX, y = box.minY;
  if (Math.abs(w - h) / Math.max(w, h) < 0.12) {
    const s = (w + h) / 2;
    x = cx - s / 2; y = cy - s / 2; w = s; h = s;
  }
  return { kind: best.kind, x, y, w, h };
}

function detectOneStrokeArrow(pts: Pt[]): Recognized | null {
  const start = pts[0];
  let tip = 0, tipD = 0;
  pts.forEach((p, i) => { const d = dist(p, start); if (d > tipD) { tipD = d; tip = i; } });
  // the pen usually passes the tip more than once while drawing the head: use the first visit
  tip = pts.findIndex((p) => dist(p, start) > tipD * 0.985);
  if (tip < 5 || tip > pts.length - 4) return null;
  const shaft = pts.slice(0, tip + 1);
  const head = pts.slice(tip);
  const shaftLen = dist(start, pts[tip]);
  const headLen = pathLength(head);
  const headSpread = Math.max(...head.map((p) => dist(p, pts[tip])));
  if (headLen < 0.12 * shaftLen || headLen > 1.3 * shaftLen) return null;
  if (headSpread > 0.5 * shaftLen) return null;
  // head should bend back towards the start, not keep going
  const back = head.some((p) => dist(p, start) < tipD - Math.max(8, 0.05 * tipD));
  if (!back) return null;

  const tipPt = pts[tip];
  const maxDev = Math.max(...shaft.map((p) => pointSegDist(p, start, tipPt)));
  const straightness = shaftLen / pathLength(shaft);
  if (maxDev < 0.07 * shaftLen) return { kind: "arrow", points: [start, snapAngle(start, tipPt)] };
  if (straightness > 0.55) {
    // curved arrow: pass through the shaft point farthest from the chord
    let mid = shaft[Math.floor(shaft.length / 2)], midD = 0;
    for (const p of shaft) { const d = pointSegDist(p, start, tipPt); if (d > midD) { midD = d; mid = p; } }
    return { kind: "arrow", points: [start, mid, tipPt] };
  }
  return null;
}

/** A small "V" / caret, used to add an arrowhead to a line drawn just before. Returns its apex. */
export function detectCaret(raw: Pt[]): { apex: Pt; size: number } | null {
  if (raw.length < 4) return null;
  const pts = resample(raw, 48);
  const a = pts[0], b = pts[pts.length - 1];
  let apexI = 0, apexD = 0;
  pts.forEach((p, i) => { const d = pointSegDist(p, a, b); if (d > apexD) { apexD = d; apexI = i; } });
  if (apexI < 3 || apexI > pts.length - 4) return null;
  const apex = pts[apexI];
  const dev = (seg: Pt[], p: Pt, q: Pt) => Math.max(...seg.map((s) => pointSegDist(s, p, q))) / Math.max(1, dist(p, q));
  if (dev(pts.slice(0, apexI + 1), a, apex) > 0.25 || dev(pts.slice(apexI), apex, b) > 0.25) return null;
  const ang = angleAt(a, apex, b);
  if (ang < 15 || ang > 135) return null;
  return { apex, size: Math.max(dist(a, apex), dist(b, apex)) };
}
