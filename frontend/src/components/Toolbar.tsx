import { useEffect, useState } from "react";
import { COLORS, useApp, type Tool } from "../store";
import Icon from "./Icons";

const TOOLS: [Tool, string, string][] = [
  ["move", "Move and zoom", "V"],
  ["rect", "Rectangle", "R"],
  ["ellipse", "Ellipse", "E"],
  ["arrow", "Arrow", "A"],
  ["pen", "Freehand", "P"],
  ["text", "Note", "T"],
];

/** Vertical tool strip for marking up the images. */
export default function Toolbar() {
  const tool = useApp((s) => s.tool);
  const setTool = useApp((s) => s.setTool);
  const color = useApp((s) => s.color);
  const setColor = useApp((s) => s.setColor);
  const undo = useApp((s) => s.undo);
  const canUndo = useApp((s) => s.history.length > 0);
  const count = useApp((s) => s.annotations.length);
  const clear = useApp((s) => s.clearAnnotations);
  const [confirmClear, setConfirmClear] = useState(false);

  useEffect(() => {
    if (!confirmClear) return;
    const t = setTimeout(() => setConfirmClear(false), 3000);
    return () => clearTimeout(t);
  }, [confirmClear]);

  return (
    <div className="toolbar" role="toolbar" aria-label="Annotation tools">
      {TOOLS.map(([id, label, key]) => (
        <button key={id} className={`tool ${tool === id ? "active" : ""}`} onClick={() => setTool(id)} title={`${label} (${key})`} aria-pressed={tool === id}>
          <Icon name={id} />
        </button>
      ))}
      <span className="sep" />
      {COLORS.map((c) => (
        <button
          key={c}
          className={`swatch ${color === c ? "active" : ""}`}
          style={{ background: c }}
          onClick={() => setColor(c)}
          title="Color for new marks"
          aria-label={`Color ${c}`}
        />
      ))}
      <span className="sep" />
      <button className="tool" onClick={undo} disabled={!canUndo} title="Undo (Ctrl/⌘ + Z)">
        <Icon name="undo" />
      </button>
      <button
        className={`tool ${confirmClear ? "danger" : ""}`}
        disabled={!count}
        onClick={() => {
          if (confirmClear) {
            clear();
            setConfirmClear(false);
          } else setConfirmClear(true);
        }}
        title={confirmClear ? "Click again to delete all marks" : "Delete all marks"}
      >
        <Icon name="trash" />
      </button>
    </div>
  );
}
