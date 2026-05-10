import { useState } from "react";
import { createPortal } from "react-dom";
import { PaneConfig } from "../types";

interface Props {
  config: PaneConfig;
  onClose: () => void;
  onSave: (patch: Partial<PaneConfig>) => void;
}

const PRESET_COLORS = [
  "#4F8FCB",
  "#E07B5C",
  "#6FB36F",
  "#C58FCB",
  "#E5B94B",
  "#5CB8B2",
  "#B86B86",
  "#7B7BCB",
];

export default function PaneSettings({ config, onClose, onSave }: Props) {
  const [name, setName] = useState(config.name);
  const [color, setColor] = useState(config.color);
  const [path, setPath] = useState(config.path);

  const autoName = (() => {
    if (path === "/" || path === "") return "/";
    const parts = path.split("/").filter(Boolean);
    return parts[parts.length - 1] || "/";
  })();

  return createPortal(
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>Pane Settings</h3>
        <label>
          Name
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={`(auto: ${autoName})`}
          />
          <span className="hint">Leave empty to use the folder name.</span>
        </label>
        <label>
          Path
          <input value={path} onChange={(e) => setPath(e.target.value)} />
        </label>
        <label>
          Color
          <div className="color-row">
            <input
              type="color"
              value={color}
              onChange={(e) => setColor(e.target.value)}
            />
            <div className="color-presets">
              {PRESET_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  className={`color-swatch ${color === c ? "active" : ""}`}
                  style={{ background: c }}
                  onClick={() => setColor(c)}
                  title={c}
                />
              ))}
            </div>
          </div>
        </label>
        <div className="modal-buttons">
          <button onClick={onClose}>Cancel</button>
          <button
            className="primary"
            onClick={() => onSave({ name, color, path })}
          >
            Save
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
