import { useCallback, useEffect, useRef, useState } from "react";
import {
  CaptureUpdateAction,
  Excalidraw,
  MainMenu,
  WelcomeScreen,
  exportToBlob,
  getCommonBounds,
  getSceneVersion,
  restoreElements,
  sceneCoordsToViewportCoords,
} from "@excalidraw/excalidraw";
import { AIPanel } from "./components/AIPanel";
import { ExportMenu } from "./components/ExportMenu";
import { VoiceLangSwitch } from "./components/VoiceLangSwitch";
import { PenBar, VOICE_TOOL, type Preset, type PresetId } from "./components/PenBar";
import { bump, toElements } from "./scene";
import { anySinhalaFontLoaded, hasSinhala, isSinhalaFace, loadSinhalaFonts, sinhalaFontsReady } from "./fonts/sinhala";
import { startVoice, type VoiceSession } from "./voice/voice";
import { SettingsDialog } from "./components/SettingsDialog";
import { Sidebar } from "./components/Sidebar";
import { handleStrokeEnd } from "./recognize/recognition";
import { SETTINGS_KEY, loadSettings, saveSettings, type Settings } from "./settings";
import {
  boardModified,
  createBoard,
  createProject,
  deleteBoard,
  listProjects,
  loadBoard,
  loadFiles,
  parseBoard,
  pickFolderWorkspace,
  renameBoard,
  requestPermission,
  restoreWorkspace,
  saveBoard,
  saveExport,
  savePreview,
  useBrowserWorkspace,
  type DiskStamp,
  type ProjectInfo,
  type WorkspaceKind,
} from "./storage/fs";
import { mergeExternal, sameScene } from "./storage/sync";

type Current = { project: ProjectInfo; board: string };

const LAST_KEY = "sketchnotes.last";
const POLL_MS = 1500; // how often the open board's file is checked for outside edits
const PREVIEW_DELAY_MS = 2500;
const PREVIEW_MAX_SIDE = 2400;

/**
 * Fills in anything an outside program left out of an element (seed, index, bindings…).
 * Text written outside the app carries customData.needsMeasure; those get measured with the real font.
 */
function normalize(elements: any[]) {
  const needsMeasure = elements.some((e) => e?.customData?.needsMeasure);
  const out = restoreElements(elements, null, { refreshDimensions: needsMeasure, repairBindings: true }) as any[];
  if (!needsMeasure) return out;
  return out.map((e) => {
    if (!e.customData?.needsMeasure) return e;
    const { needsMeasure: _, ...rest } = e.customData;
    return { ...e, customData: Object.keys(rest).length ? rest : undefined };
  });
}
const STYLE_KEYS = [
  "currentItemStrokeColor", "currentItemBackgroundColor", "currentItemFillStyle",
  "currentItemStrokeWidth", "currentItemOpacity", "currentItemRoughness",
];

export default function App() {
  const [settings, setSettings] = useState<Settings>(loadSettings);
  const [showSettings, setShowSettings] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [aiOpen, setAiOpen] = useState(true);
  const [api, setApi] = useState<any>(null);
  const [toastMsg, setToastMsg] = useState<string | null>(null);

  const [ws, setWs] = useState<FileSystemDirectoryHandle | null>(null);
  const [wsKind, setWsKind] = useState<WorkspaceKind | null>(null);
  const [needsPermission, setNeedsPermission] = useState(false);
  const [projects, setProjects] = useState<ProjectInfo[]>([]);
  const [current, setCurrent] = useState<Current | null>(null);
  const [initialData, setInitialData] = useState<any>(null);
  const [boardKey, setBoardKey] = useState(0);
  const [saveStatus, setSaveStatus] = useState("");
  const [activePreset, setActivePreset] = useState<PresetId | null>(null);
  const [voiceToolOn, setVoiceToolOn] = useState(false);
  // live caption bubble while holding down with the voice text tool (viewport coords)
  const [voiceBubble, setVoiceBubble] = useState<{ x: number; y: number; text: string; state: "listening" | "transcribing" } | null>(null);
  const voiceText = useRef<{ session: VoiceSession | null; cancelled: boolean }>({ session: null, cancelled: false });

  if (import.meta.env.DEV) (window as any).__sketchApi = api; // handy for debugging in the console

  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const save = useRef({ timer: 0 as any, lastSig: null as string | null, savedFileIds: new Set<string>(), pending: null as null | (() => Promise<void>) });
  const tempPreset = useRef<{ tool: string; restore: Record<string, any> } | null>(null);
  // the board file as we last read/wrote it; disk reads and writes run one at a time through `queue`
  const disk = useRef({ stamp: null as DiskStamp | null, syncedIds: new Set<string>(), queue: Promise.resolve() as Promise<unknown> });
  const preview = useRef({ timer: 0 as any, sig: "" });
  const live = useRef({ api: null as any, current: null as Current | null, projects: [] as ProjectInfo[], ws: null as FileSystemDirectoryHandle | null });
  live.current = { api, current, projects, ws };

  const serial = <T,>(fn: () => Promise<T>): Promise<T> => {
    const run = disk.current.queue.then(fn, fn);
    disk.current.queue = run.catch(() => undefined);
    return run;
  };

  const toast = useCallback((msg: string) => {
    setToastMsg(msg);
    window.clearTimeout((toast as any)._t);
    (toast as any)._t = window.setTimeout(() => setToastMsg(null), 3500);
  }, []);

  // ---------------------------------------------------------------- workspace

  const refresh = useCallback(async (handle = ws) => {
    if (!handle) return [];
    const list = await listProjects(handle);
    setProjects(list);
    return list;
  }, [ws]);

  const openWorkspace = useCallback(async (handle: FileSystemDirectoryHandle, kind: WorkspaceKind) => {
    setWs(handle);
    setWsKind(kind);
    setNeedsPermission(false);
    let list = await listProjects(handle);
    if (list.length === 0) {
      await createProject(handle, "My first project");
      list = await listProjects(handle);
    }
    setProjects(list);
    // reopen the last board, or the first one
    let last: { project: string; board: string } | null = null;
    try { last = JSON.parse(localStorage.getItem(LAST_KEY) || "null"); } catch { /* ignore */ }
    const proj = list.find((p) => p.name === last?.project) ?? list[0];
    const board = proj?.boards.includes(last?.board ?? "") ? last!.board : proj?.boards[0];
    if (proj && board) await openBoard(proj, board);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    restoreWorkspace().then((saved) => {
      if (!saved) return;
      if (saved.needsPermission) {
        setWs(saved.handle);
        setWsKind(saved.kind);
        setNeedsPermission(true);
      } else openWorkspace(saved.handle, saved.kind);
    });
  }, [openWorkspace]);

  const onPickFolder = async () => {
    try {
      await flushSave();
      const h = await pickFolderWorkspace();
      setCurrent(null);
      await openWorkspace(h, "folder");
    } catch (e: any) {
      if (e?.name !== "AbortError") toast(`Could not open folder: ${e.message ?? e}`);
    }
  };

  const onUseBrowser = async () => openWorkspace(await useBrowserWorkspace(), "browser");

  const onReconnect = async () => {
    if (ws && (await requestPermission(ws))) openWorkspace(ws, "folder");
    else toast("Permission was not granted.");
  };

  // ---------------------------------------------------------------- saving

  const flushSave = async () => {
    clearTimeout(save.current.timer);
    const p = save.current.pending;
    save.current.pending = null;
    if (p) await p();
  };

  /** Merges a board file that changed outside the app into the canvas. */
  const applyExternal = async (target: Current, a: any, text: string, lastModified: number) => {
    const { elements: raw, fileIndex } = parseBoard(text);
    const incoming = normalize(raw);
    const local = a.getSceneElementsIncludingDeleted();
    const merged = mergeExternal(local, incoming, disk.current.syncedIds);
    const newFiles = await loadFiles(target.project.handle, fileIndex, new Set(Object.keys(a.getFiles())));
    if (Object.keys(newFiles).length) {
      a.addFiles(Object.values(newFiles));
      for (const id of Object.keys(newFiles)) save.current.savedFileIds.add(id);
    }
    disk.current.stamp = { lastModified, text };
    disk.current.syncedIds = new Set(incoming.map((e: any) => e.id));
    if (!sameScene(local, merged)) {
      a.updateScene({ elements: merged, captureUpdate: CaptureUpdateAction.IMMEDIATELY });
      toast("Board updated from file");
    }
  };

  /** Checks whether the open board's file was changed by another program, and merges it if so. */
  const syncFromDisk = async (target: Current, a: any) => {
    const stamp = disk.current.stamp;
    if (!stamp) return;
    const file = await boardModified(target.project.handle, target.board);
    if (file.lastModified === stamp.lastModified) return;
    const text = await file.text();
    if (text === stamp.text) disk.current.stamp = { lastModified: file.lastModified, text };
    else await applyExternal(target, a, text, file.lastModified);
  };

  const makePreview = async () => {
    const { api: a, current: target } = live.current;
    if (!a || !target) return;
    const elements = a.getSceneElements();
    const sig = `${target.project.name}/${target.board}:${getSceneVersion(elements)}:${Object.keys(a.getFiles()).length}`;
    if (!elements.length || sig === preview.current.sig) return;
    const [x1, y1, x2, y2] = getCommonBounds(elements);
    const scale = Math.min(2, PREVIEW_MAX_SIDE / Math.max(x2 - x1 + 40, y2 - y1 + 40, 1));
    const st = a.getAppState();
    const png = await exportToBlob({
      elements,
      appState: { ...st, exportBackground: true, viewBackgroundColor: st.viewBackgroundColor || "#ffffff", exportWithDarkMode: false },
      files: a.getFiles(),
      mimeType: "image/png",
      exportPadding: 20,
      getDimensions: (w: number, h: number) => ({ width: w * scale, height: h * scale, scale }),
    });
    await savePreview(target.project.handle, target.board, png);
    preview.current.sig = sig;
  };

  const schedulePreview = () => {
    clearTimeout(preview.current.timer);
    preview.current.timer = setTimeout(() => makePreview().catch((e) => console.warn("Preview failed", e)), PREVIEW_DELAY_MS);
  };

  const scheduleSave = useCallback(() => {
    if (!current || !api) return;
    const target = current;
    const { project, board } = target;
    setSaveStatus("Unsaved changes…");
    const job = () =>
      serial(async () => {
        try {
          // pick up outside edits first, so saving never overwrites them
          await syncFromDisk(target, api);
          const elements = api.getSceneElements();
          disk.current.stamp = await saveBoard(project.handle, board, elements, api.getAppState(), api.getFiles(), save.current.savedFileIds);
          disk.current.syncedIds = new Set(elements.map((e: any) => e.id));
          setSaveStatus("Saved ✓");
          schedulePreview();
        } catch (e: any) {
          console.error(e);
          setSaveStatus("Save failed!");
          toast(`Save failed: ${e.message ?? e}`);
        }
      });
    save.current.pending = job;
    clearTimeout(save.current.timer);
    save.current.timer = setTimeout(() => {
      save.current.pending = null;
      job();
    }, 700);
  }, [current, api, toast]);

  useEffect(() => {
    const onHide = () => { if (document.visibilityState === "hidden") flushSave(); };
    document.addEventListener("visibilitychange", onHide);
    return () => document.removeEventListener("visibilitychange", onHide);
  }, []);

  // live reload: watch the open board's file (and the project list) for changes made outside the app
  useEffect(() => {
    if (!current || !api) return;
    const target = current;
    let tick = 0;
    const check = () =>
      serial(async () => {
        try {
          await syncFromDisk(target, api);
        } catch {
          /* file briefly missing or being written; try again next tick */
        }
        const w = live.current.ws;
        if (w && ++tick % 2 === 0) {
          const list = await listProjects(w).catch(() => null);
          const shape = (l: ProjectInfo[]) => JSON.stringify(l.map((p) => [p.name, p.boards]));
          if (list && shape(list) !== shape(live.current.projects)) setProjects(list);
        }
      });
    const id = setInterval(check, POLL_MS);
    window.addEventListener("focus", check);
    return () => {
      clearInterval(id);
      window.removeEventListener("focus", check);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current, api]);

  // write a preview for a board as soon as it's open (older boards may not have one yet)
  useEffect(() => {
    if (api) schedulePreview();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api]);

  // ---------------------------------------------------------------- boards

  const openBoard = async (project: ProjectInfo, board: string) => {
    await flushSave();
    try {
      const data = await serial(() => loadBoard(project.handle, board));
      data.elements = normalize(data.elements);
      save.current.savedFileIds = data.savedFileIds;
      save.current.lastSig = null;
      disk.current.stamp = data.stamp;
      disk.current.syncedIds = new Set(data.elements.map((e: any) => e.id));
      clearTimeout(preview.current.timer);
      const appState: any = { ...data.appState };
      if (appState.scrollX === undefined) {
        // new board: put the origin in the middle of the screen
        appState.scrollX = Math.round(window.innerWidth / 2 - 300);
        appState.scrollY = Math.round(window.innerHeight / 2);
      }
      setInitialData({ elements: data.elements, appState, files: data.files });
      setCurrent({ project, board });
      setBoardKey((k) => k + 1);
      setSaveStatus("Saved ✓");
      setActivePreset(null);
      tempPreset.current = null;
      localStorage.setItem(LAST_KEY, JSON.stringify({ project: project.name, board }));
    } catch (e: any) {
      toast(`Could not open board: ${e.message ?? e}`);
    }
  };

  const onNewProject = async () => {
    if (!ws) return;
    const name = window.prompt("Project name (e.g. client or app name):");
    if (!name?.trim()) return;
    await createProject(ws, name);
    const list = await refresh();
    const proj = list.find((p) => p.name === name.trim().replace(/[\\/:*?"<>|]/g, "-"));
    if (proj?.boards[0]) openBoard(proj, proj.boards[0]);
  };

  const onNewBoard = async (project: ProjectInfo) => {
    const date = new Date().toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
    const name = window.prompt("Board name:", `Call ${date}`);
    if (!name?.trim()) return;
    const created = await createBoard(project.handle, name);
    const list = await refresh();
    const proj = list.find((p) => p.name === project.name);
    if (proj) openBoard(proj, created);
  };

  const onRenameBoard = async (project: ProjectInfo, board: string) => {
    const name = window.prompt("Rename board:", board);
    if (!name?.trim() || name === board) return;
    const isCurrent = current?.project.name === project.name && current.board === board;
    if (isCurrent) await flushSave();
    const renamed = await renameBoard(project.handle, board, name);
    const list = await refresh();
    if (isCurrent) {
      const proj = list.find((p) => p.name === project.name)!;
      setCurrent({ project: proj, board: renamed });
      localStorage.setItem(LAST_KEY, JSON.stringify({ project: proj.name, board: renamed }));
    }
  };

  const onDeleteBoard = async (project: ProjectInfo, board: string) => {
    if (!window.confirm(`Delete the board "${board}"?\n\nIt's moved to the hidden .trash folder inside "${project.name}", so you can still get it back from there.`)) return;
    const isCurrent = current?.project.name === project.name && current.board === board;
    try {
      if (isCurrent) {
        await flushSave();
        clearTimeout(preview.current.timer);
        setCurrent(null); // stop autosave and live reload for this board before its file goes away
        setInitialData(null);
      }
      await serial(() => deleteBoard(project.handle, board));
      toast(`Deleted "${board}"`);
      let list = await refresh();
      if (!isCurrent) return;
      let proj = list.find((p) => p.name === project.name);
      if (proj && !proj.boards.length) {
        await createBoard(proj.handle, "Board 1");
        list = await refresh();
        proj = list.find((p) => p.name === project.name);
      }
      if (proj?.boards[0]) await openBoard(proj, proj.boards[0]);
    } catch (e: any) {
      toast(`Could not delete: ${e.message ?? e}`);
      refresh();
    }
  };

  const onSaveNotes = async (md: string) => {
    if (!current) return;
    const d = new Date();
    const pad = (n: number) => String(n).padStart(2, "0");
    const stamp = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}-${pad(d.getMinutes())}`;
    try {
      const path = await saveExport(current.project.handle, `${current.board} notes ${stamp}.md`, md);
      toast(`Saved to ${current.project.name}/${path}`);
    } catch (e: any) {
      toast(`Could not save: ${e.message ?? e}`);
    }
  };

  // ---------------------------------------------------------------- canvas events

  const onChange = (elements: readonly any[], appState: any, files: any) => {
    document.documentElement.dataset.theme = appState.theme;
    const voiceOn = appState.activeTool?.type === "custom" && appState.activeTool.customType === VOICE_TOOL;
    if (voiceOn !== voiceToolOn) setVoiceToolOn(voiceOn);

    // end a temporary preset (highlighter / highlight box) once the user switches tool
    const t = tempPreset.current;
    if (t && appState.activeTool?.type !== t.tool && api) {
      tempPreset.current = null;
      setActivePreset(null);
      api.updateScene({ appState: t.restore });
    }

    if (!current) return;
    const sig = `${getSceneVersion(elements)}:${Object.keys(files || {}).length}:${appState.viewBackgroundColor}`;
    if (save.current.lastSig === null) {
      save.current.lastSig = sig;
      return;
    }
    if (sig !== save.current.lastSig) {
      save.current.lastSig = sig;
      scheduleSave();
    }
  };

  // ---------------------------------------------------------------- voice text tool (hold to talk)

  const isVoiceTool = (t: any) => t?.type === "custom" && t.customType === VOICE_TOOL;

  const placeVoiceText = (origin: { x: number; y: number }, text: string) => {
    const a = live.current.api;
    if (!a) return;
    const st = a.getAppState();
    const fontSize = st.currentItemFontSize ?? 20;
    const els = toElements([{
      type: "text",
      x: origin.x,
      y: origin.y - (fontSize * 1.25) / 2, // centre the first line on the point, like the Text tool
      text,
      fontSize,
      fontFamily: st.currentItemFontFamily,
      strokeColor: st.currentItemStrokeColor,
      textAlign: st.currentItemTextAlign,
    }]);
    a.updateScene({
      elements: [...a.getSceneElementsIncludingDeleted(), ...els],
      appState: { selectedElementIds: { [els[0].id]: true } }, // ready to move or edit, like after typing
      captureUpdate: CaptureUpdateAction.IMMEDIATELY,
    });
  };

  const startVoiceText = (origin: { x: number; y: number }) => {
    const vt = voiceText.current;
    if (vt.session || !api) return;
    const vp = sceneCoordsToViewportCoords({ sceneX: origin.x, sceneY: origin.y }, api.getAppState());
    setVoiceBubble({ x: vp.x, y: vp.y, text: "", state: "listening" });
    vt.cancelled = false;
    let placed = false;
    vt.session = startVoice(settingsRef.current, {
      onInterim: (text) => setVoiceBubble((b) => b && { ...b, text }),
      onFinal: async (text) => {
        if (vt.cancelled || !text.trim()) return;
        placed = true;
        // measure Sinhala with its real font, not a stand-in
        if (hasSinhala(text)) await loadSinhalaFonts();
        placeVoiceText(origin, text.trim());
      },
      onError: (msg) => toast(msg),
      onState: (s) => {
        if (s === "transcribing") setVoiceBubble((b) => b && { ...b, state: "transcribing", text: "Transcribing…" });
        if (s === "idle") {
          vt.session = null;
          setVoiceBubble(null);
          // onFinal can arrive just after "idle" (browser engine), so check a moment later
          setTimeout(() => { if (!placed && !vt.cancelled) toast("Didn't catch any words. Hold down while you speak, then let go."); }, 50);
        }
      },
    }, { hold: true });
  };

  const stopVoiceText = () => voiceText.current.session?.stop();

  // Esc cancels a voice text recording
  useEffect(() => {
    if (!voiceBubble) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      voiceText.current.cancelled = true;
      voiceText.current.session?.cancel();
      setVoiceBubble(null);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [voiceBubble]);

  // Sinhala text measured before its font arrived is slightly the wrong size: measure it again once the font is in
  useEffect(() => {
    if (!api) return;
    const remeasure = () => {
      const all = api.getSceneElementsIncludingDeleted() as any[];
      const editing = api.getAppState().editingTextElement?.id;
      const isTarget = (e: any) => e.type === "text" && !e.isDeleted && e.id !== editing && hasSinhala(e.originalText ?? e.text);
      if (!all.some(isTarget)) return;
      const fresh = new Map((restoreElements(all, null, { refreshDimensions: true, repairBindings: true }) as any[]).map((e) => [e.id, e]));
      const byId = new Map(all.map((e) => [e.id, e]));
      const grow = new Map<string, number>(); // container id → new height
      let changed = false;
      let next = all.map((e) => {
        const f = fresh.get(e.id);
        if (!f || !isTarget(e)) return e;
        if (Math.abs(f.width - e.width) < 0.5 && Math.abs(f.height - e.height) < 0.5 && f.text === e.text) return e;
        changed = true;
        let { x, y } = f;
        const box = e.containerId ? byId.get(e.containerId) : null;
        if (box) {
          // keep a shape's label centred, and make the shape taller if the label no longer fits
          const pad = 5;
          const h = Math.max(box.height, f.height + pad * 2);
          if (h > box.height) grow.set(box.id, h);
          if (e.verticalAlign === "middle") y = box.y + (h - f.height) / 2;
        }
        return bump(e, { width: f.width, height: f.height, text: f.text, x, y });
      });
      if (grow.size) next = next.map((e) => (grow.has(e.id) ? bump(e, { height: grow.get(e.id) }) : e));
      if (changed) api.updateScene({ elements: next, captureUpdate: CaptureUpdateAction.NEVER });
    };
    const onDone = (ev: any) => {
      if ([...(ev.fontfaces ?? [])].some(isSinhalaFace)) remeasure();
    };
    // typing Sinhala starts the font download straight away, so the text editor measures with the right font
    const onInput = (ev: Event) => {
      const t = ev.target as HTMLTextAreaElement | HTMLInputElement | null;
      if (!sinhalaFontsReady() && t && "value" in t && hasSinhala(t.value)) loadSinhalaFonts();
    };
    document.fonts.addEventListener("loadingdone", onDone);
    document.addEventListener("input", onInput, true);
    // the board's fonts may have arrived before the canvas was ready
    if (anySinhalaFontLoaded()) remeasure();
    document.fonts.ready.then(() => { if (live.current.api === api && anySinhalaFontLoaded()) remeasure(); });
    return () => {
      document.fonts.removeEventListener("loadingdone", onDone);
      document.removeEventListener("input", onInput, true);
    };
  }, [api]);

  const onPointerDown = (activeTool: any, pointerDownState: any) => {
    if (isVoiceTool(activeTool)) startVoiceText(pointerDownState.origin);
  };

  const onPointerUp = (activeTool: any) => {
    if (isVoiceTool(activeTool)) return stopVoiceText();
    if (activeTool?.type === "freedraw" && settingsRef.current.recognition && api) handleStrokeEnd(api);
  };

  const pickPreset = (p: Preset) => {
    if (!api) return;
    if (p.tool === "custom") {
      if (tempPreset.current) {
        api.updateScene({ appState: tempPreset.current.restore });
        tempPreset.current = null;
      }
      api.setActiveTool({ type: "custom", customType: VOICE_TOOL });
      setActivePreset(p.id);
      return;
    }
    const st = api.getAppState();
    if (p.temporary) {
      const restore = tempPreset.current?.restore ?? Object.fromEntries(STYLE_KEYS.map((k) => [k, st[k]]));
      tempPreset.current = { tool: p.tool, restore };
    } else if (tempPreset.current) {
      api.updateScene({ appState: tempPreset.current.restore });
      tempPreset.current = null;
    }
    if (p.props) api.updateScene({ appState: p.props });
    api.setActiveTool({ type: p.tool });
    setActivePreset(p.id);
  };

  // keep settings in sync when they change in another tab, so a stale tab never overwrites newer keys
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === SETTINGS_KEY) setSettings(loadSettings());
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const openSettings = () => {
    setSettings(loadSettings()); // always edit the latest saved copy
    setShowSettings(true);
  };

  const updateSettings = (s: Settings) => {
    setSettings(s);
    saveSettings(s);
  };

  // quick switch next to the voice buttons; starts from the saved copy so no other setting is lost
  const setVoiceLang = (code: string) => updateSettings({ ...loadSettings(), voiceLang: code });

  // ---------------------------------------------------------------- render

  return (
    <div className="app">
      <Sidebar
        collapsed={sidebarCollapsed}
        onToggle={() => setSidebarCollapsed(!sidebarCollapsed)}
        workspaceName={ws?.name ?? null}
        workspaceKind={wsKind}
        needsPermission={needsPermission}
        projects={projects}
        current={current ? { project: current.project.name, board: current.board } : null}
        saveStatus={saveStatus}
        onPickFolder={onPickFolder}
        onUseBrowser={onUseBrowser}
        onReconnect={onReconnect}
        onNewProject={onNewProject}
        onNewBoard={onNewBoard}
        onOpenBoard={openBoard}
        onRenameBoard={onRenameBoard}
        onDeleteBoard={onDeleteBoard}
        onOpenSettings={openSettings}
      />

      <main className={"canvas-wrap" + (voiceToolOn ? " voice-tool" : "")}>
        {current && initialData ? (
          <>
            <Excalidraw
              key={boardKey}
              initialData={initialData}
              excalidrawAPI={setApi}
              onChange={onChange}
              onPointerDown={onPointerDown}
              onPointerUp={onPointerUp}
              name={current.board}
              UIOptions={{ canvasActions: { saveToActiveFile: false, loadScene: false } }}
              renderTopRightUI={() => (
                <div className="top-right">
                  <ExportMenu api={api} board={current.board} toast={toast} />
                  <button className="tr-btn" title="Voice prompt (Ctrl+Shift+Space)" onClick={() => window.dispatchEvent(new Event("sketchnotes:voice"))}>🎙️</button>
                  {!aiOpen && <button className="tr-btn ai" onClick={() => setAiOpen(true)}>✨ AI</button>}
                </div>
              )}
            >
              <MainMenu>
                <MainMenu.DefaultItems.Export />
                <MainMenu.DefaultItems.SaveAsImage />
                <MainMenu.DefaultItems.SearchMenu />
                <MainMenu.DefaultItems.ClearCanvas />
                <MainMenu.Separator />
                <MainMenu.Item onSelect={openSettings}>⚙︎ AI &amp; voice settings</MainMenu.Item>
                <MainMenu.DefaultItems.ToggleTheme />
                <MainMenu.DefaultItems.ChangeCanvasBackground />
                <MainMenu.DefaultItems.Help />
              </MainMenu>
              <WelcomeScreen>
                <WelcomeScreen.Center>
                  <WelcomeScreen.Center.Heading>
                    Paste or drop a screenshot (⌘V), then draw, highlight and write notes.
                    <br />
                    Ask the AI on the right — or press Ctrl+Shift+Space and say it.
                  </WelcomeScreen.Center.Heading>
                </WelcomeScreen.Center>
                <WelcomeScreen.Hints.ToolbarHint />
                <WelcomeScreen.Hints.HelpHint />
              </WelcomeScreen>
            </Excalidraw>
            <PenBar
              active={voiceToolOn ? "voice" : activePreset === "voice" ? null : activePreset}
              onPick={pickPreset}
              recognition={settings.recognition}
              onToggleRecognition={() => updateSettings({ ...settings, recognition: !settings.recognition })}
            />
            {voiceToolOn && !voiceBubble && (
              <div className="voice-hint">
                <span>🎤 Hold down where the text should go, speak, then let go.</span>
                <VoiceLangSwitch value={settings.voiceLang} onChange={setVoiceLang} />
              </div>
            )}
            {voiceBubble && (
              <div className="voice-bubble" style={{ left: voiceBubble.x, top: voiceBubble.y }}>
                <span className={"voice-dot" + (voiceBubble.state === "listening" ? " live" : "")} />
                <span className={voiceBubble.text ? "" : "muted"}>
                  {voiceBubble.text || "Listening… let go to place the text"}
                </span>
              </div>
            )}
          </>
        ) : (
          <div className="placeholder">
            <h1>✏️ SketchNotes</h1>
            <p>An infinite whiteboard for client calls: paste screenshots, mark them up, sketch, take notes, and let AI help.</p>
            <p className="muted">
              {needsPermission ? "Reconnect your projects folder in the sidebar." : ws ? "Pick a board in the sidebar." : "Open a projects folder in the sidebar to begin."}
            </p>
          </div>
        )}
      </main>

      <AIPanel
        open={aiOpen && !!current}
        onClose={() => setAiOpen(false)}
        onOpen={() => setAiOpen(true)}
        api={api}
        settings={settings}
        boardKey={current ? `${current.project.name}/${current.board}/${boardKey}` : null}
        onSaveNotes={onSaveNotes}
        onOpenSettings={openSettings}
        onVoiceLang={setVoiceLang}
        toast={toast}
      />

      {showSettings && (
        <SettingsDialog
          settings={settings}
          onClose={() => setShowSettings(false)}
          onSave={updateSettings}
        />
      )}

      {toastMsg && <div className="toast">{toastMsg}</div>}
    </div>
  );
}
