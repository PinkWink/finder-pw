import { Fragment, useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { FileEntry, GitStatus, PaneConfig } from "../types";
import FileList from "./FileList";
import PaneSettings from "./PaneSettings";
import ContextMenu, { ContextMenuItem } from "./ContextMenu";

interface Props {
  config: PaneConfig;
  isActive: boolean;
  onActivate: () => void;
  onUpdate: (patch: Partial<PaneConfig>) => void;
  onBack?: () => void;
}

function buildBreadcrumbs(path: string): { label: string; path: string }[] {
  const isAbsolute = path.startsWith("/");
  const parts = path.split("/").filter(Boolean);
  const result: { label: string; path: string }[] = [];
  if (isAbsolute) result.push({ label: "/", path: "/" });
  let acc = isAbsolute ? "" : ".";
  for (const part of parts) {
    acc += "/" + part;
    result.push({ label: part, path: acc });
  }
  return result;
}

function basename(path: string): string {
  if (path === "/" || path === "") return "/";
  const parts = path.split("/").filter(Boolean);
  return parts[parts.length - 1] || "/";
}

export default function Pane({ config, isActive, onActivate, onUpdate, onBack }: Props) {
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const [dropMsg, setDropMsg] = useState<string | null>(null);
  const [ctxMenu, setCtxMenu] = useState<{
    x: number;
    y: number;
    entry: FileEntry;
  } | null>(null);
  const [git, setGit] = useState<GitStatus | null>(null);

  const loadDir = useCallback(async (path: string) => {
    setLoading(true);
    setError(null);
    try {
      const list = await invoke<FileEntry[]>("list_directory", { path });
      setEntries(list);
    } catch (e: unknown) {
      const msg = typeof e === "string" ? e : (e as Error)?.message ?? "Unknown error";
      setError(msg);
      setEntries([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadDir(config.path);
  }, [config.path, loadDir]);

  useEffect(() => {
    if (!config.showGit) {
      setGit(null);
      return;
    }
    let cancelled = false;
    invoke<GitStatus | null>("git_status", { path: config.path })
      .then((s) => {
        if (!cancelled) setGit(s);
      })
      .catch(() => {
        if (!cancelled) setGit(null);
      });
    return () => {
      cancelled = true;
    };
  }, [config.path, config.showGit, entries]);

  const goUp = async () => {
    try {
      const parent = await invoke<string | null>("get_parent_dir", { path: config.path });
      if (parent) onUpdate({ path: parent });
    } catch {
      /* noop */
    }
  };

  const handleEntryActivate = async (entry: FileEntry) => {
    if (entry.is_dir) {
      onUpdate({ path: entry.path });
    } else {
      try {
        await invoke("open_file", { path: entry.path });
      } catch (e) {
        console.error(e);
      }
    }
  };

  const showToast = (msg: string) => {
    setDropMsg(msg);
    setTimeout(() => setDropMsg(null), 2200);
  };

  const headerStyle = { ["--pane-color" as never]: config.color } as React.CSSProperties;

  const handleDragOver = (ev: React.DragEvent) => {
    if (ev.dataTransfer.types.includes("application/finder-path")) {
      ev.preventDefault();
      ev.dataTransfer.dropEffect = "copy";
      if (!isDragOver) setIsDragOver(true);
    }
  };

  const handleDragLeave = (ev: React.DragEvent) => {
    const related = ev.relatedTarget as Node | null;
    if (related && ev.currentTarget.contains(related)) return;
    setIsDragOver(false);
  };

  const handleDrop = async (ev: React.DragEvent) => {
    ev.preventDefault();
    setIsDragOver(false);
    const src = ev.dataTransfer.getData("application/finder-path");
    if (!src) return;
    const srcParent = src.replace(/\/[^/]+$/, "") || "/";
    if (srcParent === config.path) return;
    try {
      const created = await invoke<string>("copy_path", {
        src,
        dst_dir: config.path,
      });
      const name = created.split("/").pop() ?? created;
      showToast(`Copied: ${name}`);
      loadDir(config.path);
    } catch (e: unknown) {
      const msg = typeof e === "string" ? e : (e as Error)?.message ?? "Copy failed";
      setError(msg);
    }
  };

  const openTerminal = async () => {
    try {
      await invoke("open_terminal", { path: config.path });
    } catch (e) {
      const msg = typeof e === "string" ? e : "Failed to open terminal";
      setError(msg);
    }
  };

  const buildContextMenuItems = (entry: FileEntry): ContextMenuItem[] => [
    {
      label: entry.is_dir ? "Open" : "Open with default app",
      onClick: () => handleEntryActivate(entry),
    },
    { label: "", onClick: () => {}, separator: true },
    {
      label: "Rename",
      onClick: async () => {
        const newName = window.prompt("New name:", entry.name);
        if (!newName || newName === entry.name) return;
        try {
          await invoke("rename_path", {
            path: entry.path,
            new_name: newName,
          });
          showToast(`Renamed to ${newName}`);
          loadDir(config.path);
        } catch (e) {
          const msg = typeof e === "string" ? e : "Rename failed";
          setError(msg);
        }
      },
    },
    {
      label: "Copy path",
      onClick: async () => {
        try {
          await navigator.clipboard.writeText(entry.path);
          showToast("Path copied");
        } catch {
          showToast("Clipboard unavailable");
        }
      },
    },
    { label: "", onClick: () => {}, separator: true },
    {
      label: "Move to trash",
      destructive: true,
      onClick: async () => {
        if (!window.confirm(`Delete "${entry.name}"?`)) return;
        try {
          await invoke("delete_path", { path: entry.path });
          showToast(`Deleted: ${entry.name}`);
          loadDir(config.path);
        } catch (e) {
          const msg = typeof e === "string" ? e : "Delete failed";
          setError(msg);
        }
      },
    },
  ];

  return (
    <div
      className={`pane ${isDragOver ? "drag-over" : ""} ${isActive ? "active" : ""}`}
      style={headerStyle}
      onMouseDown={onActivate}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <div className="pane-header">
        <div className="pane-color-dot" style={{ background: config.color }} />
        <div className="pane-name">
          {config.name?.trim() || basename(config.path)}
        </div>
        <label className="hidden-toggle" title="Show hidden files">
          <input
            type="checkbox"
            checked={config.showHidden ?? false}
            onChange={(e) => onUpdate({ showHidden: e.target.checked })}
          />
          <span>Hidden</span>
        </label>
        <label className="hidden-toggle" title="Show git status">
          <input
            type="checkbox"
            checked={config.showGit ?? false}
            onChange={(e) => onUpdate({ showGit: e.target.checked })}
          />
          <span>Git</span>
        </label>
        <button
          className="icon-btn"
          onClick={openTerminal}
          title="Open terminal here"
        >
          ▶_
        </button>
        {onBack && (
          <button className="icon-btn" onClick={onBack} title="Back">
            ←
          </button>
        )}
        <button className="icon-btn" onClick={goUp} title="Parent folder">↑</button>
        <button
          className="icon-btn"
          onClick={() => loadDir(config.path)}
          title="Refresh"
        >
          ⟳
        </button>
        <button
          className="icon-btn"
          onClick={() => setShowSettings(true)}
          title="Settings"
        >
          ⚙
        </button>
      </div>
      {config.showGit && git && (
        <div className="git-bar">
          <span className="git-branch">⎇ {git.branch}</span>
          {git.hasRemote && git.ahead > 0 && (
            <span className="git-ahead" title={`${git.ahead} ahead`}>
              ↑{git.ahead}
            </span>
          )}
          {git.hasRemote && git.behind > 0 && (
            <span className="git-behind" title={`${git.behind} behind`}>
              ↓{git.behind}
            </span>
          )}
          {!git.hasRemote && <span className="git-noremote">no upstream</span>}
          {git.staged > 0 && (
            <span className="git-staged" title={`${git.staged} staged`}>
              +{git.staged}
            </span>
          )}
          {git.modified > 0 && (
            <span className="git-modified" title={`${git.modified} modified`}>
              ~{git.modified}
            </span>
          )}
          {git.untracked > 0 && (
            <span className="git-untracked" title={`${git.untracked} untracked`}>
              ?{git.untracked}
            </span>
          )}
          {git.staged === 0 && git.modified === 0 && git.untracked === 0 && (
            <span className="git-clean">✓ clean</span>
          )}
        </div>
      )}
      <div className="pane-path" title={config.path}>
        {buildBreadcrumbs(config.path).map((bc, i) => (
          <Fragment key={bc.path + i}>
            {i > 0 && bc.label !== "/" && <span className="bc-sep">/</span>}
            <button
              type="button"
              className="bc-seg"
              onClick={() => onUpdate({ path: bc.path })}
              title={bc.path}
            >
              {bc.label}
            </button>
          </Fragment>
        ))}
      </div>
      <div className="pane-body">
        {loading && <div className="status-msg">Loading...</div>}
        {error && <div className="status-msg error">{error}</div>}
        {!loading && !error && (
          <FileList
            entries={
              config.showHidden
                ? entries
                : entries.filter((e) => !e.name.startsWith("."))
            }
            onActivate={handleEntryActivate}
            onContextMenu={(ev, entry) =>
              setCtxMenu({ x: ev.clientX, y: ev.clientY, entry })
            }
          />
        )}
      </div>
      {dropMsg && <div className="drop-toast">{dropMsg}</div>}
      {ctxMenu && (
        <ContextMenu
          x={ctxMenu.x}
          y={ctxMenu.y}
          items={buildContextMenuItems(ctxMenu.entry)}
          onClose={() => setCtxMenu(null)}
        />
      )}
      {showSettings && (
        <PaneSettings
          config={config}
          onClose={() => setShowSettings(false)}
          onSave={(patch) => {
            onUpdate(patch);
            setShowSettings(false);
          }}
        />
      )}
    </div>
  );
}
