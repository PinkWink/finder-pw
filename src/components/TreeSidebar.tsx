import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { FileEntry } from "../types";

interface Props {
  activePath: string;
  showHidden: boolean;
  accentColor: string;
  onSelect: (path: string) => void;
}

function basename(path: string): string {
  if (path === "/" || path === "") return "/";
  const parts = path.split("/").filter(Boolean);
  return parts[parts.length - 1] || "/";
}

function ancestorsOf(path: string): string[] {
  const out: string[] = ["/"];
  if (!path.startsWith("/") || path === "/") return out;
  const parts = path.split("/").filter(Boolean);
  let acc = "";
  for (const p of parts) {
    acc += "/" + p;
    out.push(acc);
  }
  return out;
}

interface NodeProps {
  path: string;
  depth: number;
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
  const label = depth === 0 ? path : basename(path);

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
  showHidden,
  accentColor,
  onSelect,
}: Props) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set(["/"]));
  const [childrenMap, setChildrenMap] = useState<Record<string, string[]>>({});
  const [loading, setLoading] = useState<Set<string>>(new Set());
  const lastAutoExpand = useRef<string>("");

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

  // Auto-expand to active path (and load any missing children along the way)
  useEffect(() => {
    if (lastAutoExpand.current === activePath) return;
    lastAutoExpand.current = activePath;
    const ancestors = ancestorsOf(activePath);
    setExpanded((s) => {
      const next = new Set(s);
      for (const a of ancestors) next.add(a);
      return next;
    });
    for (const a of ancestors) {
      if (childrenMap[a] === undefined) loadChildren(a);
    }
  }, [activePath, childrenMap, loadChildren]);

  // Make sure root is loaded
  useEffect(() => {
    if (childrenMap["/"] === undefined) loadChildren("/");
  }, [childrenMap, loadChildren]);

  const style = useMemo(
    () => ({ ["--tree-accent" as never]: accentColor } as React.CSSProperties),
    [accentColor]
  );

  return (
    <div className="tree-sidebar" style={style}>
      <div className="tree-header">Folders</div>
      <div className="tree-body">
        <Node
          path="/"
          depth={0}
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
