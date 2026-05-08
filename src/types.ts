export interface FileEntry {
  name: string;
  path: string;
  is_dir: boolean;
  size: number;
  modified: number;
}

export type SortKey = "name" | "size" | "modified";
export type SortDir = "asc" | "desc";

export interface PaneConfig {
  id: string;
  name: string;
  color: string;
  path: string;
  showHidden?: boolean;
  showGit?: boolean;
  history?: string[];
  sortKey?: SortKey;
  sortDir?: SortDir;
}

export interface GitStatus {
  branch: string;
  repoRoot: string;
  ahead: number;
  behind: number;
  staged: number;
  modified: number;
  untracked: number;
  hasRemote: boolean;
}

export type LayoutMode =
  | "single"
  | "horizontal"
  | "vertical"
  | "triple-left"
  | "triple-top"
  | "quad";
