import { FileEntry } from "../types";

interface Props {
  entries: FileEntry[];
  selected: Set<string>;
  onActivate: (entry: FileEntry) => void;
  onSelectClick: (ev: React.MouseEvent, entry: FileEntry) => void;
  onDragStart: (ev: React.DragEvent, entry: FileEntry) => void;
  onContextMenu?: (ev: React.MouseEvent, entry: FileEntry) => void;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function formatDate(ts: number): string {
  if (!ts) return "";
  const d = new Date(ts * 1000);
  return (
    d.toLocaleDateString() +
    " " +
    d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
  );
}

export default function FileList({
  entries,
  selected,
  onActivate,
  onSelectClick,
  onDragStart,
  onContextMenu,
}: Props) {
  if (entries.length === 0) {
    return <div className="status-msg muted">Empty</div>;
  }
  return (
    <div className="file-list">
      {entries.map((e) => (
        <div
          key={e.path}
          className={`file-row ${e.is_dir ? "dir" : "file"} ${selected.has(e.path) ? "selected" : ""}`}
          draggable
          onDragStart={(ev) => onDragStart(ev, e)}
          onClick={(ev) => {
            ev.stopPropagation();
            onSelectClick(ev, e);
          }}
          onDoubleClick={() => onActivate(e)}
          onContextMenu={(ev) => {
            ev.preventDefault();
            onContextMenu?.(ev, e);
          }}
        >
          <span className="file-icon">{e.is_dir ? "📁" : "📄"}</span>
          <span className="file-name">{e.name}</span>
          <span className="file-size">{e.is_dir ? "" : formatSize(e.size)}</span>
          <span className="file-date">{formatDate(e.modified)}</span>
        </div>
      ))}
    </div>
  );
}
