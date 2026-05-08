import { CSSProperties, ReactNode, useEffect, useRef, useState } from "react";
import { LayoutMode } from "../types";

type Sizes = { cols: [number, number]; rows: [number, number] };

const SPLITTER_PX = 6;
const MIN_PCT = 10;
const MAX_PCT = 90;

function loadSizes(layout: LayoutMode): Sizes {
  const saved = localStorage.getItem(`finder-sizes-${layout}`);
  if (saved) {
    try {
      const v = JSON.parse(saved) as Sizes;
      if (
        Array.isArray(v.cols) &&
        v.cols.length === 2 &&
        Array.isArray(v.rows) &&
        v.rows.length === 2
      ) {
        return v;
      }
    } catch {}
  }
  return { cols: [50, 50], rows: [50, 50] };
}

function saveSizes(layout: LayoutMode, sizes: Sizes) {
  localStorage.setItem(`finder-sizes-${layout}`, JSON.stringify(sizes));
}

function gridTemplate(layout: LayoutMode, s: Sizes): CSSProperties {
  const c = `${s.cols[0]}fr ${SPLITTER_PX}px ${s.cols[1]}fr`;
  const r = `${s.rows[0]}fr ${SPLITTER_PX}px ${s.rows[1]}fr`;
  switch (layout) {
    case "single":
      return { gridTemplateRows: "1fr", gridTemplateColumns: "1fr" };
    case "horizontal":
      return { gridTemplateRows: "1fr", gridTemplateColumns: c };
    case "vertical":
      return { gridTemplateRows: r, gridTemplateColumns: "1fr" };
    case "triple-left":
    case "triple-top":
    case "quad":
      return { gridTemplateRows: r, gridTemplateColumns: c };
  }
}

function paneArea(layout: LayoutMode, idx: number): string {
  switch (layout) {
    case "single":
      return "1 / 1 / 2 / 2";
    case "horizontal":
      return idx === 0 ? "1 / 1 / 2 / 2" : "1 / 3 / 2 / 4";
    case "vertical":
      return idx === 0 ? "1 / 1 / 2 / 2" : "3 / 1 / 4 / 2";
    case "quad":
      return ["1 / 1 / 2 / 2", "1 / 3 / 2 / 4", "3 / 1 / 4 / 2", "3 / 3 / 4 / 4"][idx];
    case "triple-left":
      return ["1 / 1 / 4 / 2", "1 / 3 / 2 / 4", "3 / 3 / 4 / 4"][idx];
    case "triple-top":
      return ["1 / 1 / 2 / 4", "3 / 1 / 4 / 2", "3 / 3 / 4 / 4"][idx];
  }
}

type Splitter = { axis: "v" | "h"; area: string; key: string };

function splittersFor(layout: LayoutMode): Splitter[] {
  switch (layout) {
    case "single":
      return [];
    case "horizontal":
      return [{ axis: "v", area: "1 / 2 / 2 / 3", key: "v" }];
    case "vertical":
      return [{ axis: "h", area: "2 / 1 / 3 / 2", key: "h" }];
    case "quad":
      return [
        { axis: "v", area: "1 / 2 / 4 / 3", key: "v" },
        { axis: "h", area: "2 / 1 / 3 / 4", key: "h" },
      ];
    case "triple-left":
      return [
        { axis: "v", area: "1 / 2 / 4 / 3", key: "v" },
        { axis: "h", area: "2 / 3 / 3 / 4", key: "h" },
      ];
    case "triple-top":
      return [
        { axis: "h", area: "2 / 1 / 3 / 4", key: "h" },
        { axis: "v", area: "3 / 2 / 4 / 3", key: "v" },
      ];
  }
}

interface Props {
  layout: LayoutMode;
  children: ReactNode;
}

export default function SplitGrid({ layout, children }: Props) {
  const [sizes, setSizes] = useState<Sizes>(() => loadSizes(layout));
  const containerRef = useRef<HTMLDivElement>(null);
  const sizesRef = useRef(sizes);

  useEffect(() => {
    sizesRef.current = sizes;
  }, [sizes]);

  useEffect(() => {
    setSizes(loadSizes(layout));
  }, [layout]);

  const onSplitterDown =
    (axis: "v" | "h") => (ev: React.MouseEvent<HTMLDivElement>) => {
      ev.preventDefault();
      ev.stopPropagation();
      const el = containerRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const total = axis === "v" ? rect.width : rect.height;
      const content = total - SPLITTER_PX;
      if (content <= 0) return;
      const start = axis === "v" ? ev.clientX : ev.clientY;
      const startFirst = axis === "v" ? sizes.cols[0] : sizes.rows[0];

      const prevCursor = document.body.style.cursor;
      const prevSelect = document.body.style.userSelect;
      document.body.style.cursor = axis === "v" ? "col-resize" : "row-resize";
      document.body.style.userSelect = "none";

      const onMove = (e: MouseEvent) => {
        const cur = axis === "v" ? e.clientX : e.clientY;
        const startFirstPx = (startFirst / 100) * content;
        const newPx = startFirstPx + (cur - start);
        const pct = Math.max(
          MIN_PCT,
          Math.min(MAX_PCT, (newPx / content) * 100)
        );
        setSizes((s) =>
          axis === "v"
            ? { ...s, cols: [pct, 100 - pct] }
            : { ...s, rows: [pct, 100 - pct] }
        );
      };

      const onUp = () => {
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
        document.body.style.cursor = prevCursor;
        document.body.style.userSelect = prevSelect;
        saveSizes(layout, sizesRef.current);
      };

      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    };

  const childArr = Array.isArray(children)
    ? children.filter((c) => c !== null && c !== undefined && c !== false)
    : [children];

  return (
    <div
      ref={containerRef}
      className={`pane-grid layout-${layout}`}
      style={gridTemplate(layout, sizes)}
    >
      {childArr.map((child, idx) => (
        <div
          key={idx}
          className="split-cell"
          style={{ gridArea: paneArea(layout, idx) }}
        >
          {child}
        </div>
      ))}
      {splittersFor(layout).map((sp) => (
        <div
          key={sp.key}
          className={`splitter splitter-${sp.axis}`}
          style={{ gridArea: sp.area }}
          onMouseDown={onSplitterDown(sp.axis)}
          aria-label={sp.axis === "v" ? "Resize columns" : "Resize rows"}
          role="separator"
        />
      ))}
    </div>
  );
}
