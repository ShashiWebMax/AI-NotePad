import { useCallback, useEffect, useRef, useState } from "react";
import { Excalidraw, MainMenu, WelcomeScreen, getSceneVersion } from "@excalidraw/excalidraw";
import { AIPanel } from "./components/AIPanel";
import { PenBar, type Preset, type PresetId } from "./components/PenBar";
import { SettingsDialog } from "./components/SettingsDialog";
import { Sidebar } from "./components/Sidebar";
import { handleStrokeEnd } from "./recognize/recognition";
import { SETTINGS_KEY, loadSettings, saveSettings, type Settings } from "./settings";
import {
  createBoard,
  createProject,
  listProjects,
  loadBoard,
  pickFolderWorkspace,
  renameBoard,
  requestPermission,
  restoreWorkspace,
  saveBoard,
  saveExport,
  useBrowserWorkspace,
  type ProjectInfo,
  type WorkspaceKind,
} from "./storage/fs";

type Current = { project: ProjectInfo; board: string };

const LAST_KEY = "sketchnotes.last";
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

  if (import.meta.env.DEV) (window as any).__sketchApi = api; // handy for debugging in the console

  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const save = useRef({ timer: 0 as any, lastSig: null as string | null, savedFileIds: new Set<string>(), pending: null as null | (() => Promise<void>) });
  const tempPreset = useRef<{ tool: string; restore: Record<string, any> } | null>(null);

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

  const scheduleSave = useCallback(() => {
    if (!current || !api) return;
    const { project, board } = current;
    setSaveStatus("Unsaved changes…");
    const job = async () => {
      try {
        await saveBoard(project.handle, board, api.getSceneElements(), api.getAppState(), api.getFiles(), save.current.savedFileIds);
        setSaveStatus("Saved ✓");
      } catch (e: any) {
        console.error(e);
        setSaveStatus("Save failed!");
        toast(`Save failed: ${e.message ?? e}`);
      }
    };
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

  // ---------------------------------------------------------------- boards

  const openBoard = async (project: ProjectInfo, board: string) => {
    await flushSave();
    try {
      const data = await loadBoard(project.handle, board);
      save.current.savedFileIds = data.savedFileIds;
      save.current.lastSig = null;
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

  const onPointerUp = (activeTool: any) => {
    if (activeTool?.type === "freedraw" && settingsRef.current.recognition && api) handleStrokeEnd(api);
  };

  const pickPreset = (p: Preset) => {
    if (!api) return;
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
        onOpenSettings={openSettings}
      />

      <main className="canvas-wrap">
        {current && initialData ? (
          <>
            <Excalidraw
              key={boardKey}
              initialData={initialData}
              excalidrawAPI={setApi}
              onChange={onChange}
              onPointerUp={onPointerUp}
              name={current.board}
              UIOptions={{ canvasActions: { saveToActiveFile: false, loadScene: false } }}
              renderTopRightUI={() => (
                <div className="top-right">
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
              active={activePreset}
              onPick={pickPreset}
              recognition={settings.recognition}
              onToggleRecognition={() => updateSettings({ ...settings, recognition: !settings.recognition })}
            />
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
