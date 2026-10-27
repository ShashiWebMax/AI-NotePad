// Languages offered for voice typing. `code` is a BCP-47 tag for the browser engine;
// its first part ("si") is the ISO-639-1 code the transcription APIs take.

export interface VoiceLang {
  code: string;
  label: string; // shown in Settings
  short: string; // shown on the quick switch
  /** Name and script to put in the transcription instructions. */
  prompt: string;
}

export const VOICE_LANGS: VoiceLang[] = [
  { code: "en-US", label: "English (US)", short: "EN", prompt: "English" },
  { code: "en-GB", label: "English (UK)", short: "EN-GB", prompt: "British English" },
  { code: "en-IN", label: "English (India)", short: "EN-IN", prompt: "English" },
  { code: "si-LK", label: "සිංහල — Sinhala", short: "සිං", prompt: "Sinhala, written in Sinhala script (සිංහල අකුරු), not romanised" },
  { code: "ta-LK", label: "தமிழ் — Tamil (Sri Lanka)", short: "தமி", prompt: "Tamil, written in Tamil script, not romanised" },
];

export const findLang = (code: string | undefined): VoiceLang | undefined =>
  VOICE_LANGS.find((l) => l.code.toLowerCase() === (code || "").toLowerCase());

/** "si-LK" → "si". */
export const isoCode = (code: string | undefined) => (code || "en").split(/[-_]/)[0].toLowerCase();

/** Short label for any code, including ones typed in by hand. */
export const shortLabel = (code: string) => findLang(code)?.short ?? code.toUpperCase();

/** The sentence added to the transcription instructions for this language. */
export function transcriptionHint(code: string | undefined): string {
  const lang = findLang(code);
  const name = lang?.prompt ?? code ?? "English";
  return `The speaker is speaking ${name}. Write the words exactly as spoken in that language. ` +
    "If they use some English words, keep those words in English.";
}
