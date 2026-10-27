import { findLang, shortLabel, VOICE_LANGS } from "../voice/languages";

interface Props {
  value: string;
  onChange: (code: string) => void;
}

/** Small language switch shown next to voice buttons, e.g. "EN ▾" / "සිං ▾". */
export function VoiceLangSwitch({ value, onChange }: Props) {
  const code = value || "en-US";
  return (
    <label className="lang-switch" title={`Voice language: ${findLang(code)?.label ?? code}. Change it here or in Settings.`}>
      <select aria-label="Voice language" value={code} onChange={(e) => onChange(e.target.value)}>
        {VOICE_LANGS.map((l) => (
          <option key={l.code} value={l.code}>{l.short} · {l.label}</option>
        ))}
        {!findLang(code) && <option value={code}>{shortLabel(code)}</option>}
      </select>
      <span aria-hidden="true">{shortLabel(code)} ▾</span>
    </label>
  );
}
