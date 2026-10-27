import { useState } from "react";
import type { ProjectInfo, WorkspaceKind } from "../storage/fs";
import { supportsFolderPicker } from "../storage/fs";

interface Props {
  collapsed: boolean;
  onToggle: () => void;
  workspaceName: string | null;
  workspaceKind: WorkspaceKind | null;
  needsPermission: boolean;
  projects: ProjectInfo[];
  current: { project: string; board: string } | null;
  saveStatus: string;
  onPickFolder: () => void;
  onUseBrowser: () => void;
  onReconnect: () => void;
  onNewProject: () => void;
  onNewBoard: (project: ProjectInfo) => void;
  onOpenBoard: (project: ProjectInfo, board: string) => void;
  onRenameBoard: (project: ProjectInfo, board: string) => void;
  onOpenSettings: () => void;
}

export function Sidebar(p: Props) {
  const [closed, setClosed] = useState<Record<string, boolean>>({});

  if (p.collapsed) {
    return (
      <aside className="sidebar collapsed">
        <button className="icon-btn" title="Show projects" onClick={p.onToggle}>☰</button>
      </aside>
    );
  }

  return (
    <aside className="sidebar">
      <header className="sidebar-head">
        <div className="brand">✏️ SketchNotes</div>
        <button className="icon-btn" title="Hide sidebar" onClick={p.onToggle}>«</button>
      </header>

      {!p.workspaceName && (
        <div className="ws-empty">
          <p>Pick a folder to keep your projects in. Each project is a sub-folder; each board is a <code>.excalidraw</code> file.</p>
          {supportsFolderPicker() ? (
            <button className="primary" onClick={p.onPickFolder}>Open projects folder…</button>
          ) : (
            <p className="muted small">This browser can't open local folders (use Chrome, Edge, Brave or Arc for that).</p>
          )}
          <button className="ghost" onClick={p.onUseBrowser}>Use browser storage instead</button>
        </div>
      )}

      {p.workspaceName && (
        <>
          <div className="ws-row">
            <span className="ws-name" title={p.workspaceKind === "browser" ? "Stored inside this browser" : "Local folder"}>
              {p.workspaceKind === "browser" ? "🗄️" : "📁"} {p.workspaceName}
            </span>
            {supportsFolderPicker() && (
              <button className="link" onClick={p.onPickFolder} title="Switch to another folder">Change</button>
            )}
          </div>

          {p.needsPermission ? (
            <div className="ws-empty">
              <p>Allow access to this folder again to continue.</p>
              <button className="primary" onClick={p.onReconnect}>Reconnect folder</button>
            </div>
          ) : (
            <>
              <button className="new-project" onClick={p.onNewProject}>＋ New project</button>
              <nav className="projects">
                {p.projects.length === 0 && <p className="muted small pad">No projects yet.</p>}
                {p.projects.map((proj) => {
                  const isClosed = closed[proj.name];
                  return (
                    <div key={proj.name} className="project">
                      <div className="project-row">
                        <button className="project-name" onClick={() => setClosed({ ...closed, [proj.name]: !isClosed })}>
                          <span className="caret">{isClosed ? "▸" : "▾"}</span> {proj.name}
                        </button>
                        <button className="icon-btn small" title="New board" onClick={() => p.onNewBoard(proj)}>＋</button>
                      </div>
                      {!isClosed &&
                        proj.boards.map((b) => {
                          const active = p.current?.project === proj.name && p.current?.board === b;
                          return (
                            <button
                              key={b}
                              className={"board" + (active ? " active" : "")}
                              onClick={() => p.onOpenBoard(proj, b)}
                              onDoubleClick={() => p.onRenameBoard(proj, b)}
                              title="Double-click to rename"
                            >
                              {b}
                            </button>
                          );
                        })}
                    </div>
                  );
                })}
              </nav>
            </>
          )}
        </>
      )}

      <footer className="sidebar-foot">
        <span className="muted small">{p.saveStatus}</span>
        <button className="ghost small" onClick={p.onOpenSettings}>⚙︎ Settings</button>
      </footer>
    </aside>
  );
}
