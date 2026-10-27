// Quick drawing presets shown at the bottom of the canvas.

export type PresetId = "pen" | "marker" | "pencil" | "highlighter" | "box" | "text" | "voice" | "arrow";

/** Excalidraw custom tool used for hold-to-talk voice text. */
export const VOICE_TOOL = "voice-text";

export interface Preset {
  id: PresetId;
  label: string;
  icon: string;
  tool: "freedraw" | "rectangle" | "text" | "arrow" | "custom";
  temporary?: boolean; // restore normal styles once the user switches tool
  props?: Record<string, any>;
}

export const PRESETS: Preset[] = [
  { id: "pen", label: "Pen", icon: "🖊️", tool: "freedraw", props: { currentItemStrokeColor: "#1e1e1e", currentItemStrokeWidth: 2, currentItemOpacity: 100 } },
  { id: "marker", label: "Red marker", icon: "🖍️", tool: "freedraw", props: { currentItemStrokeColor: "#e03131", currentItemStrokeWidth: 4, currentItemOpacity: 100 } },
  { id: "pencil", label: "Pencil", icon: "✏️", tool: "freedraw", props: { currentItemStrokeColor: "#495057", currentItemStrokeWidth: 1, currentItemOpacity: 100 } },
  {
    id: "highlighter", label: "Highlighter", icon: "🟨", tool: "freedraw", temporary: true,
    props: { currentItemStrokeColor: "#fab005", currentItemStrokeWidth: 6, currentItemOpacity: 40 },
  },
  {
    id: "box", label: "Highlight box", icon: "▭", tool: "rectangle", temporary: true,
    props: {
      currentItemStrokeColor: "transparent", currentItemBackgroundColor: "#ffd43b", currentItemFillStyle: "solid",
      currentItemOpacity: 35, currentItemRoughness: 0,
    },
  },
  { id: "arrow", label: "Arrow / connector", icon: "↗", tool: "arrow" },
  { id: "text", label: "Text", icon: "T", tool: "text" },
  { id: "voice", label: "Voice text: hold down where the text should go, speak, then let go", icon: "🎤", tool: "custom" },
];

interface Props {
  active: PresetId | null;
  onPick: (p: Preset) => void;
  recognition: boolean;
  onToggleRecognition: () => void;
}

export function PenBar({ active, onPick, recognition, onToggleRecognition }: Props) {
  return (
    <div className="penbar">
      {PRESETS.map((p) => (
        <button
          key={p.id}
          className={"pen-btn" + (active === p.id ? " active" : "")}
          title={p.label}
          onClick={() => onPick(p)}
        >
          <span className={p.id === "text" ? "pen-text" : ""}>{p.icon}</span>
        </button>
      ))}
      <span className="pen-sep" />
      <button
        className={"pen-toggle" + (recognition ? " on" : "")}
        onClick={onToggleRecognition}
        title="Shape recognition: freehand circles, boxes, diamonds, triangles, lines and arrows snap to clean shapes. Draw a small ‘V’ at a line’s end to add an arrowhead. Undo restores your stroke."
      >
        ✨ Auto-shapes {recognition ? "on" : "off"}
      </button>
    </div>
  );
}
