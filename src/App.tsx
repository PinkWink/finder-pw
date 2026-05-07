import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import Pane from "./components/Pane";
import Toolbar from "./components/Toolbar";
import { LayoutMode, PaneConfig } from "./types";

const DEFAULT_COLORS = ["#4F8FCB", "#E07B5C", "#6FB36F", "#C58FCB"];
const STALE_DEFAULT = /^Pane [A-D]$/;

function loadPanes(home: string): PaneConfig[] {
  const saved = localStorage.getItem("finder-panes");
  if (saved) {
    try {
      const parsed: PaneConfig[] = JSON.parse(saved);
      return parsed.map((p) => ({
        ...p,
        name: STALE_DEFAULT.test(p.name) ? "" : p.name,
      }));
    } catch {}
  }
  return Array.from({ length: 4 }, (_, i) => ({
    id: `pane-${i}`,
    name: "",
    color: DEFAULT_COLORS[i],
    path: home,
    showHidden: false,
    showGit: false,
  }));
}

function loadLayout(): LayoutMode {
  const saved = localStorage.getItem("finder-layout") as LayoutMode | null;
  return saved ?? "quad";
}

function visibleCountFor(layout: LayoutMode): number {
  switch (layout) {
    case "single":
      return 1;
    case "horizontal":
    case "vertical":
      return 2;
    case "triple-left":
    case "triple-top":
      return 3;
    case "quad":
      return 4;
  }
}

export default function App() {
  const [panes, setPanes] = useState<PaneConfig[]>([]);
  const [layout, setLayout] = useState<LayoutMode>(loadLayout());
  const [ready, setReady] = useState(false);

  useEffect(() => {
    invoke<string>("get_home_dir")
      .then((home) => {
        setPanes(loadPanes(home));
        setReady(true);
      })
      .catch(() => {
        setPanes(loadPanes("/"));
        setReady(true);
      });
  }, []);

  useEffect(() => {
    if (ready) localStorage.setItem("finder-panes", JSON.stringify(panes));
  }, [panes, ready]);

  useEffect(() => {
    localStorage.setItem("finder-layout", layout);
  }, [layout]);

  function updatePane(idx: number, patch: Partial<PaneConfig>) {
    setPanes((p) => p.map((pane, i) => (i === idx ? { ...pane, ...patch } : pane)));
  }

  if (!ready) return <div className="loading">Loading…</div>;

  const count = visibleCountFor(layout);

  return (
    <div className="app">
      <Toolbar layout={layout} onLayoutChange={setLayout} />
      <div className={`pane-grid layout-${layout}`}>
        {panes.slice(0, count).map((pane, idx) => (
          <Pane
            key={pane.id}
            config={pane}
            onUpdate={(patch) => updatePane(idx, patch)}
          />
        ))}
      </div>
    </div>
  );
}
