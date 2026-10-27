import { useState } from "react";
import { listModels } from "../ai/providers";
import { PROVIDER_LABELS, type ImageProvider, type Settings, type TextProvider } from "../settings";

interface Props {
  settings: Settings;
  onSave: (s: Settings) => void;
  onClose: () => void;
}

const TEXT_PROVIDERS: TextProvider[] = ["anthropic", "openai", "gemini", "openrouter"];
const IMAGE_PROVIDERS: ImageProvider[] = ["gemini", "openai", "openrouter"];

const KEY_LINKS: Record<TextProvider, string> = {
  anthropic: "https://console.anthropic.com/settings/keys",
  openai: "https://platform.openai.com/api-keys",
  gemini: "https://aistudio.google.com/apikey",
  openrouter: "https://openrouter.ai/settings/keys",
};

export function SettingsDialog({ settings, onSave, onClose }: Props) {
  const [s, setS] = useState<Settings>(structuredClone(settings));
  const [models, setModels] = useState<Partial<Record<TextProvider, string[]>>>({});
  const [loading, setLoading] = useState<TextProvider | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = async (prov: TextProvider) => {
    setLoading(prov);
    setError(null);
    try {
      const list = await listModels(s, prov);
      setModels((m) => ({ ...m, [prov]: list }));
    } catch (e: any) {
      setError(`${PROVIDER_LABELS[prov]}: ${e.message ?? e}`);
    } finally {
      setLoading(null);
    }
  };

  // every change is saved right away, so closing the dialog in any way never loses keys
  const set = (patch: Partial<Settings>) => {
    const next = { ...s, ...patch };
    setS(next);
    onSave(next);
  };

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <header className="modal-head">
          <h2>Settings</h2>
          <button className="icon-btn" onClick={onClose}>✕</button>
        </header>

        <div className="modal-body">
          <section>
            <h3>API keys</h3>
            <p className="muted small">
              Stored only in this browser (localStorage) and sent directly to each provider. Never written to your project folders.
            </p>
            {TEXT_PROVIDERS.map((prov) => (
              <label key={prov} className="field">
                <span>
                  {PROVIDER_LABELS[prov]}{" "}
                  <a href={KEY_LINKS[prov]} target="_blank" rel="noreferrer" className="small">get key ↗</a>
                </span>
                <input
                  type="password"
                  autoComplete="off"
                  value={s.keys[prov]}
                  placeholder="Paste API key"
                  onChange={(e) => {
                    const key = e.target.value.trim();
                    const patch: Partial<Settings> = { keys: { ...s.keys, [prov]: key } };
                    // first key for a provider: use it if the selected providers have no key yet
                    if (key && !s.keys[s.textProvider]) patch.textProvider = prov;
                    if (key && prov !== "anthropic" && !s.keys[s.imageProvider]) patch.imageProvider = prov as ImageProvider;
                    set(patch);
                  }}
                />
              </label>
            ))}
          </section>

          <section>
            <h3>Board AI (reasoning + vision)</h3>
            <div className="row">
              <label className="field">
                <span>Provider</span>
                <select value={s.textProvider} onChange={(e) => set({ textProvider: e.target.value as TextProvider })}>
                  {TEXT_PROVIDERS.map((p) => <option key={p} value={p}>{PROVIDER_LABELS[p]}</option>)}
                </select>
              </label>
              <label className="field grow">
                <span>Model</span>
                <div className="with-btn">
                  <input
                    list={`models-${s.textProvider}`}
                    value={s.textModels[s.textProvider]}
                    onChange={(e) => set({ textModels: { ...s.textModels, [s.textProvider]: e.target.value } })}
                  />
                  <button className="small" onClick={() => load(s.textProvider)} disabled={loading !== null}>
                    {loading === s.textProvider ? "…" : "Load list"}
                  </button>
                </div>
              </label>
            </div>
            {s.textProvider !== "openrouter" && (
              <label className="field">
                <span>Thinking effort</span>
                <select value={s.effort} onChange={(e) => set({ effort: e.target.value as Settings["effort"] })}>
                  <option value="default">{s.textProvider === "gemini" ? "Default (low, fastest for calls)" : "Model default"}</option>
                  <option value="low">Low (fastest)</option>
                  <option value="medium">Medium</option>
                  <option value="high">High (best for complex diagrams)</option>
                </select>
              </label>
            )}
          </section>

          <section>
            <h3>Image generation</h3>
            <div className="row">
              <label className="field">
                <span>Provider</span>
                <select value={s.imageProvider} onChange={(e) => set({ imageProvider: e.target.value as ImageProvider })}>
                  {IMAGE_PROVIDERS.map((p) => <option key={p} value={p}>{PROVIDER_LABELS[p]}</option>)}
                </select>
              </label>
              <label className="field grow">
                <span>Model</span>
                <div className="with-btn">
                  <input
                    list={`models-${s.imageProvider}`}
                    value={s.imageModels[s.imageProvider]}
                    onChange={(e) => set({ imageModels: { ...s.imageModels, [s.imageProvider]: e.target.value } })}
                  />
                  <button className="small" onClick={() => load(s.imageProvider)} disabled={loading !== null}>
                    {loading === s.imageProvider ? "…" : "Load list"}
                  </button>
                </div>
              </label>
            </div>
            <p className="muted small">
              Gemini “Nano Banana” image models are best at editing a screenshot while keeping its layout. OpenAI uses gpt-image models;
              on OpenRouter pick a model whose output includes images.
            </p>
          </section>

          <section>
            <h3>Voice prompts</h3>
            <div className="row">
              <label className="field">
                <span>Engine</span>
                <select value={s.voiceEngine} onChange={(e) => set({ voiceEngine: e.target.value as Settings["voiceEngine"] })}>
                  <option value="browser">Browser (free, live captions)</option>
                  <option value="openai">OpenAI transcription</option>
                  <option value="gemini">Gemini transcription</option>
                </select>
              </label>
              {s.voiceEngine === "browser" && (
                <label className="field">
                  <span>Language</span>
                  <input value={s.voiceLang} onChange={(e) => set({ voiceLang: e.target.value })} placeholder="en-US" />
                </label>
              )}
              {s.voiceEngine === "openai" && (
                <label className="field grow">
                  <span>Model</span>
                  <input value={s.voiceModelOpenAI} onChange={(e) => set({ voiceModelOpenAI: e.target.value })} />
                </label>
              )}
              {s.voiceEngine === "gemini" && (
                <label className="field grow">
                  <span>Model</span>
                  <input value={s.voiceModelGemini} onChange={(e) => set({ voiceModelGemini: e.target.value })} />
                </label>
              )}
            </div>
            <label className="check">
              <input type="checkbox" checked={s.voiceAutoSend} onChange={(e) => set({ voiceAutoSend: e.target.checked })} />
              Send to the AI as soon as I stop talking
            </label>
          </section>

          {error && <div className="ai-card error">{error}</div>}

          {TEXT_PROVIDERS.map((prov) => (
            <datalist key={prov} id={`models-${prov}`}>
              {(models[prov] ?? []).map((m) => <option key={m} value={m} />)}
            </datalist>
          ))}
        </div>

        <footer className="modal-foot">
          <span className="muted small">Changes are saved automatically.</span>
          <button className="primary" onClick={onClose}>Done</button>
        </footer>
      </div>
    </div>
  );
}
