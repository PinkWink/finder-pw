import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";

export interface ContextMenuItem {
  label: string;
  onClick: () => void;
  separator?: boolean;
  destructive?: boolean;
  disabled?: boolean;
}

interface Props {
  x: number;
  y: number;
  items: ContextMenuItem[];
  onClose: () => void;
}

export default function ContextMenu({ x, y, items, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDown = (ev: MouseEvent) => {
      if (ref.current && !ref.current.contains(ev.target as Node)) onClose();
    };
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  useEffect(() => {
    if (!ref.current) return;
    const rect = ref.current.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const adjustedX = Math.min(x, vw - rect.width - 4);
    const adjustedY = Math.min(y, vh - rect.height - 4);
    ref.current.style.left = `${Math.max(4, adjustedX)}px`;
    ref.current.style.top = `${Math.max(4, adjustedY)}px`;
  }, [x, y]);

  return createPortal(
    <div ref={ref} className="ctx-menu" style={{ left: x, top: y }}>
      {items.map((item, i) =>
        item.separator ? (
          <div key={`sep-${i}`} className="ctx-sep" />
        ) : (
          <button
            key={item.label + i}
            className={`ctx-item ${item.destructive ? "destructive" : ""}`}
            onClick={() => {
              if (!item.disabled) {
                item.onClick();
                onClose();
              }
            }}
            disabled={item.disabled}
          >
            {item.label}
          </button>
        )
      )}
    </div>,
    document.body
  );
}
