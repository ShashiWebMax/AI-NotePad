import { useEffect, useRef, useState } from "react";
import { exportBoard, type ExportFormat } from "../export/exportBoard";

interface Props {
  api: any;
  board: string;
  toast: (msg: string) => void;
}

const OPTIONS: { format: ExportFormat; label: string; hint: string }[] = [
  { format: "pdf", label: "PDF", hint: "to share or print" },
  { format: "png", label: "PNG image", hint: "sharp, 2×" },
  { format: "svg", label: "SVG image", hint: "scalable" },
];

/** Top-right "Export" button: downloads the board (or the selection) as PDF, PNG or SVG. */
export function ExportMenu({ api, board, toast }: Props) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<ExportFormat | null>(null);
  const [hasSelection, setHasSelection] = useState(false);
  const [selectionOnly, setSelectionOnly] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const toggle = () => {
    if (!open && api) {
      const sel = Object.keys(api.getAppState().selectedElementIds || {}).length > 0;
      setHasSelection(sel);
      setSelectionOnly(sel);
    }
    setOpen(!open);
  };

  const run = async (format: ExportFormat) => {
    if (!api || busy) return;
    setBusy(format);
    try {
      const file = await exportBoard(api, board, format, hasSelection && selectionOnly);
      toast(`Exported ${file}`);
      setOpen(false);
    } catch (e: any) {
      toast(e?.message ?? `Export failed: ${e}`);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="export-menu" ref={ref}>
      <button className="tr-btn" title="Export this board as PDF or image" aria-expanded={open} onClick={toggle}>
        ⤓ Export
      </button>
      {open && (
        <div className="export-pop" role="menu">
          {OPTIONS.map((o) => (
            <button key={o.format} role="menuitem" disabled={!!busy} onClick={() => run(o.format)}>
              {busy === o.format ? "Exporting…" : o.label}
              <small>{o.hint}</small>
            </button>
          ))}
          {hasSelection && (
            <label className="note" style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <input type="checkbox" checked={selectionOnly} onChange={(e) => setSelectionOnly(e.target.checked)} />
              Only the selected items
            </label>
          )}
        </div>
      )}
    </div>
  );
}
