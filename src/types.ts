export interface FileEntry {
  name: string;
  path: string;
  is_dir: boolean;
  size: number;
  modified: number;
}

export interface PaneConfig {
  id: string;
  name: string;
  color: string;
  path: string;
  showHidden?: boolean;
  showGit?: boolean;
  history?: string[];
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
