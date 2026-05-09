import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import Pane from "./components/Pane";
import Toolbar from "./components/Toolbar";
import TreeSidebar from "./components/TreeSidebar";
import SplitGrid from "./components/SplitGrid";
import { LayoutMode, PaneConfig } from "./types";

const DEFAULT_COLORS = ["#4F8FCB", "#E07B5C", "#6FB36F", "#C58FCB"];
const STALE_DEFAULT = /^Pane [A-D]$/;
const HISTORY_LIMIT = 20;

function loadPanes(home: string): PaneConfig[] {
  const saved = localStorage.getItem("finder-panes");
  if (saved) {
    try {
      const parsed: PaneConfig[] = JSON.parse(saved);
      return parsed.map((p) => {
        const fallbackPath = p.lastLocalPath ?? home;
        return {
          ...p,
          name: STALE_DEFAULT.test(p.name) ? "" : p.name,
          history: p.history ?? [],
          remote: undefined,
          path: p.remote ? fallbackPath : p.path,
        };
      });
    } catch {}
  }
  return Array.from({ length: 4 }, (_, i) => ({
    id: `pane-${i}`,
    name: "",
    color: DEFAULT_COLORS[i],
    path: home,
    showHidden: false,
    showGit: false,
    history: [],
  }));
}

function loadLayout(): LayoutMode {
  const saved = localStorage.getItem("finder-layout") as LayoutMode | null;
  return saved ?? "quad";
}

function loadShowTree(): boolean {
  return localStorage.getItem("finder-show-tree") === "1";
}

function loadActiveIndex(): number {
  const v = parseInt(localStorage.getItem("finder-active-pane") ?? "0", 10);
  return Number.isFinite(v) && v >= 0 && v < 4 ? v : 0;
}

function loadFontSize(): number {
  const v = parseInt(localStorage.getItem("finder-font-size") ?? "14", 10);
  return Number.isFinite(v) && v >= 10 && v <= 28 ? v : 14;
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
  const [showTree, setShowTree] = useState<boolean>(loadShowTree());
  const [activeIndex, setActiveIndex] = useState<number>(loadActiveIndex());
  const [fontSize, setFontSize] = useState<number>(loadFontSize());
  const [home, setHome] = useState<string>("/");
  const [ready, setReady] = useState(false);

  useEffect(() => {
    invoke<string>("get_home_dir")
      .then((h) => {
        setHome(h);
        setPanes(loadPanes(h));
        setReady(true);
      })
      .catch(() => {
        setPanes(loadPanes("/"));
        setReady(true);
      });
  }, []);

  useEffect(() => {
    if (ready) {
      const sanitized = panes.map((p) => {
        const { remote: _r, ...rest } = p;
        return rest;
      });
      localStorage.setItem("finder-panes", JSON.stringify(sanitized));
    }
  }, [panes, ready]);

  useEffect(() => {
    localStorage.setItem("finder-layout", layout);
  }, [layout]);

  useEffect(() => {
    localStorage.setItem("finder-show-tree", showTree ? "1" : "0");
  }, [showTree]);

  useEffect(() => {
    localStorage.setItem("finder-active-pane", String(activeIndex));
  }, [activeIndex]);

  useEffect(() => {
    localStorage.setItem("finder-font-size", String(fontSize));
  }, [fontSize]);

  function updatePane(idx: number, patch: Partial<PaneConfig>) {
    setPanes((p) =>
      p.map((pane, i) => {
        if (i !== idx) return pane;
        let history = pane.history ?? [];
        if (patch.path !== undefined && patch.path !== pane.path) {
          history = [pane.path, ...history.filter((h) => h !== pane.path)].slice(
            0,
            HISTORY_LIMIT
          );
        }
        const merged: PaneConfig = { ...pane, ...patch, history };
        if (!merged.remote && patch.path !== undefined) {
          merged.lastLocalPath = patch.path;
        }
        return merged;
      })
    );
  }

  function goBack(idx: number) {
    setPanes((p) =>
      p.map((pane, i) => {
        if (i !== idx) return pane;
        const history = pane.history ?? [];
        if (history.length === 0) return pane;
        const [prev, ...rest] = history;
        return { ...pane, path: prev, history: rest };
      })
    );
  }

  if (!ready) return <div className="loading">Loading…</div>;

  const count = visibleCountFor(layout);
  const visiblePanes = panes.slice(0, count);
  const safeActive = Math.min(activeIndex, count - 1);
  const activePane = visiblePanes[safeActive];

  return (
    <div
      className="app"
      style={{ ["--app-font-size" as never]: `${fontSize}px` } as React.CSSProperties}
    >
      <Toolbar
        layout={layout}
        onLayoutChange={setLayout}
        showTree={showTree}
        onToggleTree={() => setShowTree((v) => !v)}
        fontSize={fontSize}
        onFontSizeChange={setFontSize}
      />
      <div className="main">
        {showTree && activePane && !activePane.remote && (
          <TreeSidebar
            activePath={activePane.path}
            homeDir={home}
            showHidden={activePane.showHidden ?? false}
            accentColor={activePane.color}
            onSelect={(path) => updatePane(safeActive, { path })}
          />
        )}
        <SplitGrid layout={layout}>
          {visiblePanes.map((pane, idx) => (
            <Pane
              key={pane.id}
              config={pane}
              isActive={idx === safeActive}
              onActivate={() => setActiveIndex(idx)}
              onUpdate={(patch) => updatePane(idx, patch)}
              onBack={
                (pane.history ?? []).length > 0
                  ? () => goBack(idx)
                  : undefined
              }
            />
          ))}
        </SplitGrid>
      </div>
    </div>
  );
}
