import { useCallback, useEffect, useRef, useState } from "react";
import { insertNote, runAI, type HistoryTurn, type Mode, type Scope } from "../ai/agent";
import { PROVIDER_LABELS, type Settings } from "../settings";
import { startVoice, type VoiceSession } from "../voice/voice";
import { VoiceLangSwitch } from "./VoiceLangSwitch";

interface Entry {
  id: number;
  role: "user" | "ai" | "error";
  text: string;
  notes?: string;
  mode?: Mode;
}

interface Props {
  open: boolean;
  onClose: () => void;
  onOpen: () => void;
  api: any;
  settings: Settings;
  boardKey: string | null;
  onSaveNotes: (markdown: string) => void;
  onOpenSettings: () => void;
  onVoiceLang: (code: string) => void;
  toast: (msg: string) => void;
}

const SUGGESTIONS: { text: string; mode: Mode }[] = [
  { text: "Mark up this screenshot with the changes we discussed (highlights + sticky notes).", mode: "canvas" },
  { text: "Turn my rough sketch into a clean diagram.", mode: "canvas" },
  { text: "Summarise every requested change on this board as a task list.", mode: "canvas" },
  { text: "Generate a mockup of this screen with the requested changes applied.", mode: "image" },
];

const IMAGE_WORDS = /\b(generate|create|make|render|draw)\b.*\b(image|picture|mock-?up|illustration|photo|render(ing)?)\b/i;

let nextId = 1;
const TIMEOUT_MS = 3 * 60 * 1000;

export function AIPanel(p: Props) {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [prompt, setPrompt] = useState("");
  const [mode, setMode] = useState<Mode>("canvas");
  const [scope, setScope] = useState<Scope>("auto");
  const [busy, setBusy] = useState<string | null>(null);
  const [voice, setVoice] = useState<"listening" | "transcribing" | "idle">("idle");
  const voiceRef = useRef<VoiceSession | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const history = useRef<HistoryTurn[]>([]);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  // per-board conversation
  useEffect(() => {
    setEntries([]);
    history.current = [];
  }, [p.boardKey]);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
  }, [entries, busy]);

  const add = (e: Omit<Entry, "id">) => setEntries((list) => [...list, { ...e, id: nextId++ }]);

  const send = useCallback(
    async (text: string, forcedMode?: Mode) => {
      const q = text.trim();
      if (!q || busy || !p.api) return;
      const m = forcedMode ?? mode;
      setPrompt("");
      add({ role: "user", text: q, mode: m });
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      const signal = AbortSignal.any([ctrl.signal, AbortSignal.timeout(TIMEOUT_MS)]);
      try {
        const out = await runAI(p.api, p.settings, q, m, scope, history.current, setBusy, signal);
        add({ role: "ai", text: [out.message, out.imageText].filter(Boolean).join("\n\n"), notes: out.notes });
        history.current.push({ prompt: q, reply: out.message + (out.notes ? `\n[notes]\n${out.notes}` : "") });
      } catch (e: any) {
        console.error(e);
        const text = ctrl.signal.aborted
          ? "Cancelled."
          : signal.aborted
            ? `No answer after ${TIMEOUT_MS / 60000} minutes, so I stopped waiting. The provider may be overloaded: try again, or pick a faster model in Settings.`
            : e?.message ?? String(e);
        add({ role: "error", text });
      } finally {
        abortRef.current = null;
        setBusy(null);
      }
    },
    [busy, p.api, p.settings, mode, scope],
  );

  const sendRef = useRef(send);
  sendRef.current = send;

  const toggleVoice = useCallback(() => {
    if (voiceRef.current) {
      voiceRef.current.stop();
      return;
    }
    p.onOpen();
    voiceRef.current = startVoice(p.settings, {
      onInterim: (t) => setPrompt(t),
      onFinal: (t) => {
        setPrompt(t);
        if (p.settings.voiceAutoSend) {
          // pick image mode when the request clearly asks for a picture
          sendRef.current(t, IMAGE_WORDS.test(t) ? "image" : undefined);
        } else textRef.current?.focus();
      },
      onError: (msg) => p.toast(msg),
      onState: (s) => {
        setVoice(s);
        if (s === "idle") voiceRef.current = null;
      },
    });
  }, [p]);

  // global shortcut + event from the toolbar mic button
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === "Space" && e.ctrlKey && e.shiftKey) {
        e.preventDefault();
        toggleVoice();
      }
      if (e.key === "Escape" && voiceRef.current) voiceRef.current.cancel();
    };
    const onEvt = () => toggleVoice();
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("sketchnotes:voice", onEvt);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("sketchnotes:voice", onEvt);
    };
  }, [toggleVoice]);

  const hasKey = Object.values(p.settings.keys).some(Boolean);
  const model = p.settings.textModels[p.settings.textProvider];
  const imgModel = p.settings.imageModels[p.settings.imageProvider];

  const insertOnBoard = (md: string) => {
    if (!p.api) return;
    const st = p.api.getAppState();
    const z = st.zoom?.value ?? 1;
    insertNote(p.api, { x: -st.scrollX + 40, y: -st.scrollY + 80, w: 0, h: 0 }, md);
  };

  return (
    <aside className={"ai-panel" + (p.open ? "" : " hidden")}>
      <header className="ai-head">
        <div>
          <div className="ai-title">AI assistant</div>
          <div className="muted small" title="Change in Settings">
            {mode === "image" ? `${p.settings.imageProvider} · ${imgModel}` : `${PROVIDER_LABELS[p.settings.textProvider]} · ${model}`}
          </div>
        </div>
        <button className="icon-btn" onClick={p.onClose} title="Close">✕</button>
      </header>

      <div className="ai-list" ref={listRef}>
        {!hasKey && (
          <div className="ai-card warn">
            Add an API key (Claude, OpenAI, Gemini or OpenRouter) to start.
            <button className="primary small" onClick={p.onOpenSettings}>Open settings</button>
          </div>
        )}
        {entries.length === 0 && (
          <div className="ai-intro">
            <p className="muted small">
              The AI sees your <b>selection</b> (or what's on screen if nothing is selected) as an image, plus all text on the board.
              Hold a thought? Press <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>Space</kbd> and just say it.
            </p>
            {SUGGESTIONS.map((s) => (
              <button key={s.text} className="suggestion" onClick={() => { setMode(s.mode); send(s.text, s.mode); }}>
                {s.mode === "image" ? "🖼️ " : "✨ "}
                {s.text}
              </button>
            ))}
          </div>
        )}
        {entries.map((e) => (
          <div key={e.id} className={"msg " + e.role}>
            {e.role === "user" && e.mode === "image" && <span className="tag">image</span>}
            <div className="msg-text">{e.text}</div>
            {e.notes && (
              <div className="notes">
                <pre>{e.notes}</pre>
                <div className="notes-actions">
                  <button className="small" onClick={() => { navigator.clipboard.writeText(e.notes!); p.toast("Copied"); }}>Copy</button>
                  <button className="small" onClick={() => insertOnBoard(e.notes!)}>Put on board</button>
                  <button className="small" onClick={() => p.onSaveNotes(e.notes!)}>Save .md</button>
                </div>
              </div>
            )}
          </div>
        ))}
        {busy && (
          <div className="msg status">
            <span className="spinner" /> {busy}
            <button className="small cancel" onClick={() => abortRef.current?.abort()}>Cancel</button>
          </div>
        )}
      </div>

      <div className="ai-input">
        <div className="ai-controls">
          <div className="seg">
            <button className={mode === "canvas" ? "on" : ""} onClick={() => setMode("canvas")} title="AI edits the board: draws, annotates, writes notes">Board</button>
            <button className={mode === "image" ? "on" : ""} onClick={() => setMode("image")} title="Generate an image from the selection + prompt">Image</button>
          </div>
          <select value={scope} onChange={(e) => setScope(e.target.value as Scope)} title="What the AI looks at">
            <option value="auto">Selection / screen</option>
            <option value="board">Whole board</option>
          </select>
        </div>
        <textarea
          ref={textRef}
          value={prompt}
          placeholder={voice === "listening" ? "Listening…" : mode === "image" ? "Describe the image to generate…" : "Ask or tell the AI what to change…"}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send(prompt);
            }
          }}
          rows={3}
        />
        <div className="ai-buttons">
          <div className="voice-group">
          <button
            className={"mic" + (voice !== "idle" ? " live" : "")}
            onClick={toggleVoice}
            title="Voice prompt (Ctrl+Shift+Space). Stops after a short pause."
          >
            {voice === "transcribing" ? "…" : "🎙️"} {voice === "listening" ? "Stop" : voice === "transcribing" ? "Transcribing" : "Speak"}
          </button>
          <VoiceLangSwitch value={p.settings.voiceLang} onChange={p.onVoiceLang} />
          </div>
          <button className="primary" disabled={!prompt.trim() || !!busy} onClick={() => send(prompt)}>
            {busy ? "Working…" : "Send ↵"}
          </button>
        </div>
      </div>
    </aside>
  );
}
