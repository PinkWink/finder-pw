import { LayoutMode } from "../types";

interface Props {
  layout: LayoutMode;
  onLayoutChange: (l: LayoutMode) => void;
  showTree: boolean;
  onToggleTree: () => void;
  fontSize: number;
  onFontSizeChange: (px: number) => void;
}

const LAYOUTS: { mode: LayoutMode; label: string; icon: string }[] = [
  { mode: "single", label: "Single", icon: "▢" },
  { mode: "horizontal", label: "Side", icon: "▤" },
  { mode: "vertical", label: "Stack", icon: "▥" },
  { mode: "triple-left", label: "Tri L", icon: "◧" },
  { mode: "triple-top", label: "Tri T", icon: "⬒" },
  { mode: "quad", label: "Quad", icon: "▦" },
];

export const FONT_SIZES = [12, 14, 16, 18, 20];

export default function Toolbar({
  layout,
  onLayoutChange,
  showTree,
  onToggleTree,
  fontSize,
  onFontSizeChange,
}: Props) {
  return (
    <div className="toolbar">
      <div className="toolbar-title">PWFinder</div>
      <button
        className={`layout-btn tree-btn ${showTree ? "active" : ""}`}
        onClick={onToggleTree}
        title="Toggle folder tree sidebar"
      >
        <span className="layout-icon">⌘</span>
        <span className="layout-label">Tree</span>
      </button>
      <div className="toolbar-sep" />
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
      <div className="toolbar-spacer" />
      <label className="font-size-control" title="목록·트리·경로 글자 크기">
        <span className="font-size-label">Aa</span>
        <select
          value={fontSize}
          onChange={(e) => onFontSizeChange(parseInt(e.target.value, 10))}
        >
          {FONT_SIZES.map((s) => (
            <option key={s} value={s}>
              {s}px
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
