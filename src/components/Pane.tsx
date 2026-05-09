import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import { invoke } from "@tauri-apps/api/core";
import { FileEntry, GitStatus, PaneConfig, SortKey, SortDir } from "../types";
import FileList from "./FileList";
import PaneSettings from "./PaneSettings";
import SshConnectModal from "./SshConnectModal";
import ContextMenu, { ContextMenuItem } from "./ContextMenu";
import {
  copyOne,
  deletePath,
  getParentDir,
  listDir,
  openEntry,
  renamePath,
  sshDisconnect,
} from "../fsApi";

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

const DRAG_MIME = "application/finder-paths";

interface DragPayload {
  v: 1;
  paneId: string;
  sessionId: string | null;
  paths: string[];
}

export default function Pane({
  config,
  isActive,
  onActivate,
  onUpdate,
  onBack,
}: Props) {
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const [dropMsg, setDropMsg] = useState<string | null>(null);
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number } | null>(null);
  const [git, setGit] = useState<GitStatus | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [anchor, setAnchor] = useState<string | null>(null);
  const [showSsh, setShowSsh] = useState(false);
  const [busyMsg, setBusyMsg] = useState<string | null>(null);

  const sessionId = config.remote?.sessionId ?? null;
  const isRemote = sessionId !== null;

  const loadDir = useCallback(
    async (path: string) => {
      setLoading(true);
      setError(null);
      try {
        const list = await listDir(sessionId, path);
        setEntries(list);
      } catch (e: unknown) {
        const msg = typeof e === "string" ? e : (e as Error)?.message ?? "Unknown error";
        setError(msg);
        setEntries([]);
      } finally {
        setLoading(false);
      }
    },
    [sessionId]
  );

  useEffect(() => {
    loadDir(config.path);
    setSelected(new Set());
    setAnchor(null);
  }, [config.path, loadDir]);

  useEffect(() => {
    if (!config.showGit || isRemote) {
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
  }, [config.path, config.showGit, entries, isRemote]);

  const visibleEntries = useMemo(
    () =>
      config.showHidden
        ? entries
        : entries.filter((e) => !e.name.startsWith(".")),
    [entries, config.showHidden]
  );

  const sortKey: SortKey = config.sortKey ?? "name";
  const sortDir: SortDir = config.sortDir ?? "asc";

  const sortedEntries = useMemo(() => {
    const cmp = (a: FileEntry, b: FileEntry) => {
      let v = 0;
      if (sortKey === "name") {
        v = a.name.localeCompare(b.name, undefined, { sensitivity: "base", numeric: true });
      } else if (sortKey === "size") {
        v = a.size - b.size;
        if (v === 0) v = a.name.localeCompare(b.name);
      } else {
        v = a.modified - b.modified;
        if (v === 0) v = a.name.localeCompare(b.name);
      }
      return sortDir === "asc" ? v : -v;
    };
    const folders = visibleEntries.filter((e) => e.is_dir);
    const files = visibleEntries.filter((e) => !e.is_dir);
    folders.sort(cmp);
    files.sort(cmp);
    return [...folders, ...files];
  }, [visibleEntries, sortKey, sortDir]);

  const handleSortChange = (key: SortKey) => {
    if (key === sortKey) {
      onUpdate({ sortDir: sortDir === "asc" ? "desc" : "asc" });
    } else {
      onUpdate({ sortKey: key, sortDir: "asc" });
    }
  };

  const goUp = async () => {
    try {
      const parent = await getParentDir(sessionId, config.path);
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
        await openEntry(sessionId, entry.path);
      } catch (e) {
        console.error(e);
      }
    }
  };

  const showToast = useCallback((msg: string) => {
    setDropMsg(msg);
    setTimeout(() => setDropMsg(null), 2200);
  }, []);

  const handleSelectClick = (ev: React.MouseEvent, entry: FileEntry) => {
    if (ev.shiftKey && anchor) {
      const i1 = sortedEntries.findIndex((e) => e.path === anchor);
      const i2 = sortedEntries.findIndex((e) => e.path === entry.path);
      if (i1 >= 0 && i2 >= 0) {
        const [s, e] = i1 < i2 ? [i1, i2] : [i2, i1];
        setSelected(
          new Set(sortedEntries.slice(s, e + 1).map((x) => x.path))
        );
      }
    } else if (ev.ctrlKey || ev.metaKey) {
      setSelected((prev) => {
        const next = new Set(prev);
        if (next.has(entry.path)) next.delete(entry.path);
        else next.add(entry.path);
        return next;
      });
      setAnchor(entry.path);
    } else {
      setSelected(new Set([entry.path]));
      setAnchor(entry.path);
    }
  };

  const clearSelection = () => {
    setSelected(new Set());
    setAnchor(null);
  };

  const deleteSelected = useCallback(async () => {
    const paths = Array.from(selected);
    if (paths.length === 0) return;
    const msg =
      paths.length === 1
        ? `Delete "${basename(paths[0])}"?`
        : `Delete ${paths.length} items?`;
    if (!window.confirm(msg)) return;
    let deleted = 0;
    let lastError: string | null = null;
    for (const p of paths) {
      try {
        await deletePath(sessionId, p);
        deleted++;
      } catch (e) {
        lastError = typeof e === "string" ? e : "Delete failed";
      }
    }
    showToast(deleted === 1 ? "Deleted: 1 item" : `Deleted: ${deleted} items`);
    if (lastError && deleted < paths.length) setError(lastError);
    setSelected(new Set());
    setAnchor(null);
    loadDir(config.path);
  }, [selected, loadDir, config.path, sessionId, showToast]);

  // Keyboard shortcuts on the active pane
  useEffect(() => {
    if (!isActive) return;
    const onKey = (ev: KeyboardEvent) => {
      const target = ev.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" || target.tagName === "TEXTAREA")
      )
        return;

      if ((ev.ctrlKey || ev.metaKey) && ev.key === "a") {
        ev.preventDefault();
        setSelected(new Set(sortedEntries.map((e) => e.path)));
        return;
      }
      if (ev.key === "Escape") {
        setSelected(new Set());
        setAnchor(null);
        return;
      }
      if (
        (ev.key === "Delete" || ev.key === "Backspace") &&
        selected.size > 0 &&
        !ev.metaKey &&
        !ev.ctrlKey
      ) {
        ev.preventDefault();
        deleteSelected();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [isActive, sortedEntries, selected, deleteSelected]);

  const headerStyle = { ["--pane-color" as never]: config.color } as React.CSSProperties;

  const handleDragOver = (ev: React.DragEvent) => {
    if (ev.dataTransfer.types.includes(DRAG_MIME)) {
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
    const data = ev.dataTransfer.getData(DRAG_MIME);
    if (!data) return;
    let payload: DragPayload;
    try {
      payload = JSON.parse(data);
      if (!payload || payload.v !== 1 || !Array.isArray(payload.paths)) return;
    } catch {
      return;
    }
    const sameSession =
      (payload.sessionId ?? null) === (config.remote?.sessionId ?? null);
    let copied = 0;
    let lastError: string | null = null;
    let lastName = "";
    setBusyMsg(
      payload.paths.length === 1
        ? `Copying ${basename(payload.paths[0])}…`
        : `Copying ${payload.paths.length} items…`
    );
    try {
      for (const src of payload.paths) {
        if (sameSession) {
          const srcParent = src.replace(/\/[^/]+$/, "") || "/";
          if (srcParent === config.path) continue;
        }
        try {
          const created = await copyOne(
            { sessionId: payload.sessionId, path: src },
            { sessionId, path: config.path }
          );
          copied++;
          lastName = created.split("/").pop() ?? created;
        } catch (e: unknown) {
          lastError =
            typeof e === "string" ? e : (e as Error)?.message ?? "Copy failed";
        }
      }
    } finally {
      setBusyMsg(null);
    }
    if (copied > 0) {
      showToast(
        copied === 1 ? `Copied: ${lastName}` : `Copied: ${copied} items`
      );
      loadDir(config.path);
    }
    if (lastError && copied === 0) setError(lastError);
  };

  const handleDragStart = (ev: React.DragEvent, entry: FileEntry) => {
    let toDrag: string[];
    if (selected.has(entry.path) && selected.size > 1) {
      toDrag = Array.from(selected);
    } else {
      toDrag = [entry.path];
      setSelected(new Set([entry.path]));
      setAnchor(entry.path);
    }
    const payload: DragPayload = {
      v: 1,
      paneId: config.id,
      sessionId: config.remote?.sessionId ?? null,
      paths: toDrag,
    };
    ev.dataTransfer.setData(DRAG_MIME, JSON.stringify(payload));
    ev.dataTransfer.setData("text/plain", toDrag.join("\n"));
    ev.dataTransfer.effectAllowed = "copy";
  };

  const openTerminal = async () => {
    if (isRemote) return;
    try {
      await invoke("open_terminal", { path: config.path });
    } catch (e) {
      const msg = typeof e === "string" ? e : "Failed to open terminal";
      setError(msg);
    }
  };

  const handleConnected = async (result: {
    sessionId: string;
    homeDir: string;
    user: string;
    host: string;
    port: number;
  }) => {
    setShowSsh(false);
    onUpdate({
      remote: {
        sessionId: result.sessionId,
        user: result.user,
        host: result.host,
        port: result.port,
        homeDir: result.homeDir,
      },
      path: result.homeDir,
      showGit: false,
    });
    showToast(`Connected: ${result.user}@${result.host}`);
  };

  const handleDisconnect = async () => {
    if (!config.remote) return;
    const sessionId = config.remote.sessionId;
    setBusyMsg("Disconnecting…");
    try {
      await sshDisconnect(sessionId);
    } catch (e) {
      console.error(e);
    }
    let home = "/";
    try {
      home = await invoke<string>("get_home_dir");
    } catch {
      /* noop */
    }
    onUpdate({ remote: undefined, path: home });
    setBusyMsg(null);
    showToast("Disconnected");
  };

  const buildContextMenuItems = (): ContextMenuItem[] => {
    const paths = Array.from(selected);
    const isMulti = paths.length > 1;
    const single = paths[0];
    const singleEntry = entries.find((e) => e.path === single);

    return [
      {
        label: isMulti
          ? `${paths.length} items selected`
          : singleEntry?.is_dir
            ? "Open"
            : "Open with default app",
        disabled: isMulti,
        onClick: () => {
          if (singleEntry) handleEntryActivate(singleEntry);
        },
      },
      { label: "", onClick: () => {}, separator: true },
      {
        label: "Rename",
        disabled: isMulti || !singleEntry,
        onClick: async () => {
          if (!singleEntry) return;
          const newName = window.prompt("New name:", singleEntry.name);
          if (!newName || newName === singleEntry.name) return;
          try {
            await renamePath(sessionId, singleEntry.path, newName);
            showToast(`Renamed to ${newName}`);
            loadDir(config.path);
          } catch (e) {
            const msg = typeof e === "string" ? e : "Rename failed";
            setError(msg);
          }
        },
      },
      {
        label: isMulti ? `Copy paths (${paths.length})` : "Copy path",
        onClick: async () => {
          try {
            await navigator.clipboard.writeText(paths.join("\n"));
            showToast(isMulti ? `${paths.length} paths copied` : "Path copied");
          } catch {
            showToast("Clipboard unavailable");
          }
        },
      },
      { label: "", onClick: () => {}, separator: true },
      {
        label: "Open terminal here",
        onClick: openTerminal,
      },
      { label: "", onClick: () => {}, separator: true },
      {
        label: isMulti
          ? `Move ${paths.length} items to trash`
          : "Move to trash",
        destructive: true,
        onClick: deleteSelected,
      },
    ];
  };

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
        {config.remote && (
          <span
            className="ssh-badge"
            title={`SSH ${config.remote.user}@${config.remote.host}:${config.remote.port}`}
          >
            🌐 {config.remote.user}@{config.remote.host}
          </span>
        )}
        {selected.size > 0 && (
          <span className="selection-count" title="Selected items">
            {selected.size}
          </span>
        )}
        <label className="hidden-toggle" title="Show hidden files">
          <input
            type="checkbox"
            checked={config.showHidden ?? false}
            onChange={(e) => onUpdate({ showHidden: e.target.checked })}
          />
          <span>Hidden</span>
        </label>
        {!isRemote && (
          <label className="hidden-toggle" title="Show git status">
            <input
              type="checkbox"
              checked={config.showGit ?? false}
              onChange={(e) => onUpdate({ showGit: e.target.checked })}
            />
            <span>Git</span>
          </label>
        )}
        {!isRemote && (
          <button
            className="icon-btn"
            onClick={openTerminal}
            title="Open terminal here"
          >
            ▶_
          </button>
        )}
        {isRemote ? (
          <button
            className="icon-btn"
            onClick={handleDisconnect}
            title="Disconnect SSH"
          >
            ⏏
          </button>
        ) : (
          <button
            className="icon-btn"
            onClick={() => setShowSsh(true)}
            title="Connect via SSH"
          >
            🌐
          </button>
        )}
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
      <div className="pane-body" onClick={clearSelection}>
        {loading && <div className="status-msg">Loading...</div>}
        {error && <div className="status-msg error">{error}</div>}
        {!loading && !error && (
          <FileList
            entries={sortedEntries}
            selected={selected}
            sortKey={sortKey}
            sortDir={sortDir}
            onSortChange={handleSortChange}
            onActivate={handleEntryActivate}
            onSelectClick={handleSelectClick}
            onDragStart={handleDragStart}
            onContextMenu={(ev, entry) => {
              if (!selected.has(entry.path)) {
                setSelected(new Set([entry.path]));
                setAnchor(entry.path);
              }
              setCtxMenu({ x: ev.clientX, y: ev.clientY });
            }}
          />
        )}
      </div>
      {dropMsg && <div className="drop-toast">{dropMsg}</div>}
      {busyMsg && <div className="drop-toast busy">{busyMsg}</div>}
      {ctxMenu && (
        <ContextMenu
          x={ctxMenu.x}
          y={ctxMenu.y}
          items={buildContextMenuItems()}
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
      {showSsh && (
        <SshConnectModal
          onClose={() => setShowSsh(false)}
          onConnected={handleConnected}
        />
      )}
    </div>
  );
}
