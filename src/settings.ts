// App settings, kept in this browser's localStorage (never written to project folders).

export type TextProvider = "anthropic" | "openai" | "gemini" | "openrouter";
export type ImageProvider = "gemini" | "openai" | "openrouter";
export type VoiceEngine = "browser" | "openai" | "gemini";
export type Effort = "default" | "low" | "medium" | "high";

export interface Settings {
  keys: Record<TextProvider, string>;
  textProvider: TextProvider;
  textModels: Record<TextProvider, string>;
  imageProvider: ImageProvider;
  imageModels: Record<ImageProvider, string>;
  effort: Effort;
  voiceEngine: VoiceEngine;
  voiceModelOpenAI: string;
  voiceModelGemini: string;
  voiceAutoSend: boolean;
  voiceLang: string;
  recognition: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  keys: { anthropic: "", openai: "", gemini: "", openrouter: "" },
  textProvider: "anthropic",
  textModels: {
    anthropic: "claude-opus-5-5",
    openai: "gpt-5",
    gemini: "gemini-3.5-flash",
    openrouter: "anthropic/claude-opus-4.5",
  },
  imageProvider: "gemini",
  imageModels: {
    gemini: "gemini-3-pro-image",
    openai: "gpt-image-1",
    openrouter: "google/gemini-3.1-flash-image",
  },
  effort: "default",
  voiceEngine: "browser",
  voiceModelOpenAI: "gpt-4o-transcribe",
  voiceModelGemini: "gemini-flash-latest",
  voiceAutoSend: true,
  voiceLang: "en-US",
  recognition: true,
};

export const SETTINGS_KEY = "sketchnotes.settings.v1";

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return structuredClone(DEFAULT_SETTINGS);
    const s = JSON.parse(raw);
    // models that providers have retired: move saved settings onto the current defaults
    const RETIRED: Record<string, string> = {
      "gemini-2.5-pro": DEFAULT_SETTINGS.textModels.gemini,
      "gemini-2.5-flash-image": DEFAULT_SETTINGS.imageModels.gemini,
      "gemini-2.5-flash": DEFAULT_SETTINGS.voiceModelGemini,
    };
    if (RETIRED[s.textModels?.gemini]) s.textModels.gemini = RETIRED[s.textModels.gemini];
    if (RETIRED[s.imageModels?.gemini]) s.imageModels.gemini = RETIRED[s.imageModels.gemini];
    if (RETIRED[s.voiceModelGemini]) s.voiceModelGemini = RETIRED[s.voiceModelGemini];
    if (s.imageModels?.openrouter === "google/gemini-2.5-flash-image") s.imageModels.openrouter = DEFAULT_SETTINGS.imageModels.openrouter;
    return {
      ...DEFAULT_SETTINGS,
      ...s,
      keys: { ...DEFAULT_SETTINGS.keys, ...s.keys },
      textModels: { ...DEFAULT_SETTINGS.textModels, ...s.textModels },
      imageModels: { ...DEFAULT_SETTINGS.imageModels, ...s.imageModels },
    };
  } catch {
    return structuredClone(DEFAULT_SETTINGS);
  }
}

export function saveSettings(s: Settings) {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
  } catch {
    /* storage unavailable */
  }
}

export const PROVIDER_LABELS: Record<TextProvider, string> = {
  anthropic: "Claude (Anthropic)",
  openai: "ChatGPT (OpenAI)",
  gemini: "Gemini (Google)",
  openrouter: "OpenRouter",
};
