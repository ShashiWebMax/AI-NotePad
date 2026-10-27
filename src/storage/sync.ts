// Merges a board that another program (e.g. Claude) changed on disk into the open canvas.
//
// Rules, per element id:
// - on disk and on the canvas: keep whichever has the higher `version` (Excalidraw bumps it on every edit)
// - only on disk: new from outside, add it
// - only on the canvas: if it was in the file the last time we synced, it was deleted outside, so delete it;
//   otherwise it is a local change that hasn't been saved yet, so keep it

type El = Record<string, any>;

export function mergeExternal(local: readonly El[], disk: readonly El[], syncedIds: Set<string>): El[] {
  const localById = new Map(local.map((e) => [e.id, e]));
  const diskIds = new Set<string>();
  const out: El[] = [];
  for (const d of disk) {
    diskIds.add(d.id);
    const l = localById.get(d.id);
    out.push(l && (l.version ?? 0) > (d.version ?? 0) ? l : d);
  }
  for (const l of local) {
    if (diskIds.has(l.id)) continue;
    if (syncedIds.has(l.id) && !l.isDeleted) {
      out.push({ ...l, isDeleted: true, version: (l.version ?? 0) + 1, versionNonce: Math.floor(Math.random() * 2 ** 31), updated: Date.now() });
    } else out.push(l);
  }
  return out;
}

/** True when the merge changes nothing visible (so there is no need to touch the canvas). */
export function sameScene(a: readonly El[], b: readonly El[]): boolean {
  if (a.length !== b.length) return false;
  const byId = new Map(a.map((e) => [e.id, e]));
  return b.every((e) => {
    const o = byId.get(e.id);
    return o && o.version === e.version && o.versionNonce === e.versionNonce && !!o.isDeleted === !!e.isDeleted;
  });
}
