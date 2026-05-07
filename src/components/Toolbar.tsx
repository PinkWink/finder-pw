import { LayoutMode } from "../types";

interface Props {
  layout: LayoutMode;
  onLayoutChange: (l: LayoutMode) => void;
}

const LAYOUTS: { mode: LayoutMode; label: string; icon: string }[] = [
  { mode: "single", label: "Single", icon: "▢" },
  { mode: "horizontal", label: "Side", icon: "▤" },
  { mode: "vertical", label: "Stack", icon: "▥" },
  { mode: "triple-left", label: "Tri L", icon: "◧" },
  { mode: "triple-top", label: "Tri T", icon: "⬒" },
  { mode: "quad", label: "Quad", icon: "▦" },
];

export default function Toolbar({ layout, onLayoutChange }: Props) {
  return (
    <div className="toolbar">
      <div className="toolbar-title">Finder</div>
      <div className="layout-buttons">
        {LAYOUTS.map((l) => (
          <button
            key={l.mode}
            className={`layout-btn ${layout === l.mode ? "active" : ""}`}
            onClick={() => onLayoutChange(l.mode)}
            title={l.label}
          >
            <span className="layout-icon">{l.icon}</span>
            <span className="layout-label">{l.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
