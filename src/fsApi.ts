import { invoke } from "@tauri-apps/api/core";
import { FileEntry } from "./types";

export interface ConnectResult {
  sessionId: string;
  homeDir: string;
  user: string;
  host: string;
  port: number;
}

export type SshAuth =
  | { kind: "password"; password: string }
  | { kind: "key"; path: string; passphrase?: string }
  | { kind: "agent" };

export async function listDir(
  sessionId: string | null,
  path: string
): Promise<FileEntry[]> {
  if (sessionId) {
    return invoke<FileEntry[]>("ssh_list_directory", {
      session_id: sessionId,
      path,
    });
  }
  return invoke<FileEntry[]>("list_directory", { path });
}

export async function getParentDir(
  sessionId: string | null,
  path: string
): Promise<string | null> {
  if (sessionId) {
    const r = await invoke<string | null>("ssh_get_parent_dir", { path });
    return r ?? null;
  }
  const r = await invoke<string | null>("get_parent_dir", { path });
  return r ?? null;
}

export async function openEntry(
  sessionId: string | null,
  path: string
): Promise<void> {
  if (sessionId) {
    return invoke("ssh_open_file", { session_id: sessionId, path });
  }
  return invoke("open_file", { path });
}

export async function deletePath(
  sessionId: string | null,
  path: string
): Promise<void> {
  if (sessionId) {
    return invoke("ssh_delete", { session_id: sessionId, path });
  }
  return invoke("delete_path", { path });
}

export async function renamePath(
  sessionId: string | null,
  path: string,
  newName: string
): Promise<string> {
  if (sessionId) {
    return invoke<string>("ssh_rename", {
      session_id: sessionId,
      path,
      new_name: newName,
    });
  }
  return invoke<string>("rename_path", { path, new_name: newName });
}

export async function createDir(
  sessionId: string | null,
  parent: string,
  name: string
): Promise<string> {
  if (sessionId) {
    return invoke<string>("ssh_create_dir", {
      session_id: sessionId,
      parent,
      name,
    });
  }
  return invoke<string>("create_dir", { parent, name });
}

export async function copyOne(
  src: { sessionId: string | null; path: string },
  dst: { sessionId: string | null; path: string }
): Promise<string> {
  if (!src.sessionId && !dst.sessionId) {
    return invoke<string>("copy_path", { src: src.path, dst_dir: dst.path });
  }
  if (!src.sessionId && dst.sessionId) {
    return invoke<string>("ssh_copy_to_remote", {
      session_id: dst.sessionId,
      src: src.path,
      dst_dir: dst.path,
    });
  }
  if (src.sessionId && !dst.sessionId) {
    return invoke<string>("ssh_copy_from_remote", {
      session_id: src.sessionId,
      src: src.path,
      dst_dir: dst.path,
    });
  }
  return invoke<string>("ssh_copy_remote_to_remote", {
    src_session_id: src.sessionId,
    src: src.path,
    dst_session_id: dst.sessionId,
    dst_dir: dst.path,
  });
}

export async function sshConnect(
  attemptId: string,
  host: string,
  port: number,
  user: string,
  auth: SshAuth
): Promise<ConnectResult> {
  return invoke<ConnectResult>("ssh_connect", {
    attempt_id: attemptId,
    host,
    port,
    user,
    auth,
  });
}

export async function sshCancelConnect(attemptId: string): Promise<void> {
  return invoke("ssh_cancel_connect", { attempt_id: attemptId });
}

export async function sshDisconnect(sessionId: string): Promise<void> {
  return invoke("ssh_disconnect", { session_id: sessionId });
}
