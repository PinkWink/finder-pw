import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { FileEntry } from "../types";

interface Props {
  activePath: string;
  homeDir: string;
  showHidden: boolean;
  accentColor: string;
  onSelect: (path: string) => void;
}

function basename(path: string): string {
  if (path === "/" || path === "") return "/";
  const parts = path.split("/").filter(Boolean);
  return parts[parts.length - 1] || "/";
}

function isUnder(path: string, root: string): boolean {
  if (path === root) return true;
  const prefix = root === "/" ? "/" : root + "/";
  return path.startsWith(prefix);
}

function ancestorsOf(path: string, root: string): string[] {
  if (!isUnder(path, root) || path === root) return [root];
  const rest = root === "/" ? path.slice(1) : path.slice(root.length + 1);
  const parts = rest.split("/").filter(Boolean);
  const out: string[] = [root];
  let acc = root === "/" ? "" : root;
  for (const p of parts) {
    acc += "/" + p;
    out.push(acc);
  }
  return out;
}

interface NodeProps {
  path: string;
  depth: number;
  rootPath: string;
  activePath: string;
  showHidden: boolean;
  expanded: Set<string>;
  childrenMap: Record<string, string[]>;
  loading: Set<string>;
  toggleExpand: (path: string) => void;
  onSelect: (path: string) => void;
}

function Node({
  path,
  depth,
  rootPath,
  activePath,
  expanded,
  childrenMap,
  loading,
  showHidden,
  toggleExpand,
  onSelect,
}: NodeProps) {
  const isExpanded = expanded.has(path);
  const isLoading = loading.has(path);
  const kids = childrenMap[path];
  const isActive = path === activePath;
  const label = path === rootPath ? path : basename(path);

  const visibleKids = kids
    ? showHidden
      ? kids
      : kids.filter((c) => !basename(c).startsWith("."))
    : null;

  return (
    <>
      <div
        className={`tree-node ${isActive ? "active" : ""}`}
        style={{ paddingLeft: depth * 14 + 6 }}
        onClick={() => onSelect(path)}
        title={path}
        data-tree-path={path}
      >
        <button
          className="tree-toggle"
          onClick={(e) => {
            e.stopPropagation();
            toggleExpand(path);
          }}
        >
          {isLoading ? "…" : isExpanded ? "▾" : "▸"}
        </button>
        <span className="tree-label">{label}</span>
      </div>
      {isExpanded && visibleKids && visibleKids.length > 0 && (
        <>
          {visibleKids.map((c) => (
            <Node
              key={c}
              path={c}
              depth={depth + 1}
              rootPath={rootPath}
              activePath={activePath}
              showHidden={showHidden}
              expanded={expanded}
              childrenMap={childrenMap}
              loading={loading}
              toggleExpand={toggleExpand}
              onSelect={onSelect}
            />
          ))}
        </>
      )}
    </>
  );
}

export default function TreeSidebar({
  activePath,
  homeDir,
  showHidden,
  accentColor,
  onSelect,
}: Props) {
  const root = useMemo(() => {
    if (homeDir && homeDir !== "/" && isUnder(activePath, homeDir)) {
      return homeDir;
    }
    return "/";
  }, [activePath, homeDir]);

  const [expanded, setExpanded] = useState<Set<string>>(() => new Set([root]));
  const [childrenMap, setChildrenMap] = useState<Record<string, string[]>>({});
  const [loading, setLoading] = useState<Set<string>>(new Set());
  const bodyRef = useRef<HTMLDivElement>(null);

  const loadChildren = useCallback(
    async (path: string) => {
      if (childrenMap[path] !== undefined) return;
      setLoading((s) => new Set(s).add(path));
      try {
        const list = await invoke<FileEntry[]>("list_directory", { path });
        const dirs = list.filter((e) => e.is_dir).map((e) => e.path);
        setChildrenMap((c) => ({ ...c, [path]: dirs }));
      } catch {
        setChildrenMap((c) => ({ ...c, [path]: [] }));
      } finally {
        setLoading((s) => {
          const next = new Set(s);
          next.delete(path);
          return next;
        });
      }
    },
    [childrenMap]
  );

  const toggleExpand = useCallback(
    (path: string) => {
      setExpanded((s) => {
        const next = new Set(s);
        if (next.has(path)) next.delete(path);
        else next.add(path);
        return next;
      });
      if (childrenMap[path] === undefined) loadChildren(path);
    },
    [childrenMap, loadChildren]
  );

  // Always reveal the active pane's folder by expanding root → activePath each
  // time either the path or the root changes.
  useEffect(() => {
    const ancestors = ancestorsOf(activePath, root);
    setExpanded((s) => {
      const next = new Set(s);
      for (const a of ancestors) next.add(a);
      return next;
    });
    for (const a of ancestors) {
      if (childrenMap[a] === undefined) loadChildren(a);
    }
  }, [activePath, root, childrenMap, loadChildren]);

  // Scroll the active node into view once it's actually rendered (i.e. all
  // ancestors have loaded their children). Re-runs when childrenMap changes
  // so we catch the moment the active node first appears in the DOM.
  useEffect(() => {
    const body = bodyRef.current;
    if (!body) return;
    const escaped =
      typeof CSS !== "undefined" && "escape" in CSS
        ? CSS.escape(activePath)
        : activePath.replace(/"/g, '\\"');
    const el = body.querySelector(
      `[data-tree-path="${escaped}"]`
    ) as HTMLElement | null;
    if (!el) return;
    const elTop = el.offsetTop;
    const elBottom = elTop + el.offsetHeight;
    const viewTop = body.scrollTop;
    const viewBottom = viewTop + body.clientHeight;
    if (elTop < viewTop || elBottom > viewBottom) {
      el.scrollIntoView({ block: "nearest" });
    }
  }, [activePath, expanded, childrenMap]);

  const style = useMemo(
    () => ({ ["--tree-accent" as never]: accentColor } as React.CSSProperties),
    [accentColor]
  );

  return (
    <div className="tree-sidebar" style={style}>
      <div className="tree-header">Folders</div>
      <div className="tree-body" ref={bodyRef}>
        <Node
          path={root}
          depth={0}
          rootPath={root}
          activePath={activePath}
          showHidden={showHidden}
          expanded={expanded}
          childrenMap={childrenMap}
          loading={loading}
          toggleExpand={toggleExpand}
          onSelect={onSelect}
        />
      </div>
    </div>
  );
}
