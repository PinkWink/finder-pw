use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::UNIX_EPOCH;

#[derive(Serialize)]
struct FileEntry {
    name: String,
    path: String,
    is_dir: bool,
    size: u64,
    modified: u64,
}

#[tauri::command]
fn list_directory(path: String) -> Result<Vec<FileEntry>, String> {
    let p = PathBuf::from(&path);
    let entries = fs::read_dir(&p).map_err(|e| format!("{}: {}", path, e))?;

    let mut result = Vec::new();
    for entry in entries.flatten() {
        let metadata = match entry.metadata() {
            Ok(m) => m,
            Err(_) => continue,
        };
        let modified = metadata
            .modified()
            .ok()
            .and_then(|m| m.duration_since(UNIX_EPOCH).ok())
            .map(|d| d.as_secs())
            .unwrap_or(0);
        result.push(FileEntry {
            name: entry.file_name().to_string_lossy().to_string(),
            path: entry.path().to_string_lossy().to_string(),
            is_dir: metadata.is_dir(),
            size: metadata.len(),
            modified,
        });
    }

    result.sort_by(|a, b| {
        b.is_dir
            .cmp(&a.is_dir)
            .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });

    Ok(result)
}

#[tauri::command]
fn get_home_dir() -> Result<String, String> {
    dirs::home_dir()
        .map(|p| p.to_string_lossy().to_string())
        .ok_or_else(|| "Could not find home directory".to_string())
}

#[tauri::command]
fn get_parent_dir(path: String) -> Option<String> {
    PathBuf::from(&path)
        .parent()
        .map(|p| p.to_string_lossy().to_string())
}

#[tauri::command]
fn open_file(path: String) -> Result<(), String> {
    Command::new("xdg-open")
        .arg(&path)
        .spawn()
        .map_err(|e| e.to_string())?;
    Ok(())
}

fn unique_target(dst_dir: &Path, name: &str) -> PathBuf {
    let candidate = dst_dir.join(name);
    if !candidate.exists() {
        return candidate;
    }
    let p = Path::new(name);
    let stem = p
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or(name);
    let ext = p.extension().and_then(|s| s.to_str());
    for i in 1..1000 {
        let new_name = match ext {
            Some(e) => format!("{} (copy {}).{}", stem, i, e),
            None => format!("{} (copy {})", stem, i),
        };
        let candidate = dst_dir.join(&new_name);
        if !candidate.exists() {
            return candidate;
        }
    }
    dst_dir.join(format!("{}_copy", name))
}

fn copy_recursive(src: &Path, dst: &Path) -> std::io::Result<()> {
    if src.is_dir() {
        fs::create_dir_all(dst)?;
        for entry in fs::read_dir(src)? {
            let entry = entry?;
            copy_recursive(&entry.path(), &dst.join(entry.file_name()))?;
        }
    } else {
        fs::copy(src, dst)?;
    }
    Ok(())
}

#[tauri::command(rename_all = "snake_case")]
fn rename_path(path: String, new_name: String) -> Result<String, String> {
    if new_name.is_empty() || new_name.contains('/') {
        return Err("이름이 비었거나 슬래시를 포함합니다".to_string());
    }
    let p = PathBuf::from(&path);
    let parent = p
        .parent()
        .ok_or_else(|| "상위 디렉토리가 없습니다".to_string())?;
    let new_path = parent.join(&new_name);
    if new_path.exists() {
        return Err(format!("이미 존재: {}", new_name));
    }
    fs::rename(&p, &new_path).map_err(|e| e.to_string())?;
    Ok(new_path.to_string_lossy().to_string())
}

#[tauri::command]
fn delete_path(path: String) -> Result<(), String> {
    let trashed = Command::new("gio")
        .args(["trash", &path])
        .status()
        .map(|s| s.success())
        .unwrap_or(false);
    if trashed {
        return Ok(());
    }
    let p = PathBuf::from(&path);
    if p.is_dir() {
        fs::remove_dir_all(&p).map_err(|e| e.to_string())
    } else {
        fs::remove_file(&p).map_err(|e| e.to_string())
    }
}

#[tauri::command(rename_all = "snake_case")]
fn create_dir(parent: String, name: String) -> Result<String, String> {
    if name.is_empty() || name.contains('/') {
        return Err("이름이 비었거나 슬래시를 포함합니다".to_string());
    }
    let p = PathBuf::from(&parent).join(&name);
    if p.exists() {
        return Err(format!("이미 존재: {}", name));
    }
    fs::create_dir(&p).map_err(|e| e.to_string())?;
    Ok(p.to_string_lossy().to_string())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct GitStatus {
    branch: String,
    repo_root: String,
    ahead: u32,
    behind: u32,
    staged: u32,
    modified: u32,
    untracked: u32,
    has_remote: bool,
}

fn run_git(cwd: &str, args: &[&str]) -> Option<String> {
    let output = Command::new("git")
        .args(args)
        .current_dir(cwd)
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    Some(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

#[tauri::command]
fn git_status(path: String) -> Result<Option<GitStatus>, String> {
    let p = PathBuf::from(&path);
    if !p.is_dir() {
        return Ok(None);
    }
    if run_git(&path, &["rev-parse", "--is-inside-work-tree"]).as_deref() != Some("true") {
        return Ok(None);
    }
    let repo_root = run_git(&path, &["rev-parse", "--show-toplevel"]).unwrap_or_default();
    let branch =
        run_git(&path, &["rev-parse", "--abbrev-ref", "HEAD"]).unwrap_or_else(|| "HEAD".to_string());

    let mut ahead = 0u32;
    let mut behind = 0u32;
    let mut has_remote = false;
    if let Some(counts) = run_git(&path, &["rev-list", "--left-right", "--count", "HEAD...@{u}"]) {
        has_remote = true;
        let parts: Vec<&str> = counts.split_whitespace().collect();
        if parts.len() == 2 {
            ahead = parts[0].parse().unwrap_or(0);
            behind = parts[1].parse().unwrap_or(0);
        }
    }

    let mut staged = 0u32;
    let mut modified = 0u32;
    let mut untracked = 0u32;
    if let Some(status) = run_git(&path, &["status", "--porcelain=v1"]) {
        for line in status.lines() {
            let chars: Vec<char> = line.chars().take(2).collect();
            if chars.len() < 2 {
                continue;
            }
            let x = chars[0];
            let y = chars[1];
            if x == '?' && y == '?' {
                untracked += 1;
            } else {
                if x != ' ' && x != '?' {
                    staged += 1;
                }
                if y != ' ' && y != '?' {
                    modified += 1;
                }
            }
        }
    }

    Ok(Some(GitStatus {
        branch,
        repo_root,
        ahead,
        behind,
        staged,
        modified,
        untracked,
        has_remote,
    }))
}

#[tauri::command]
fn open_terminal(path: String) -> Result<(), String> {
    let candidates: &[(&str, &str)] = &[
        ("x-terminal-emulator", "--working-directory"),
        ("gnome-terminal", "--working-directory"),
        ("konsole", "--workdir"),
        ("xfce4-terminal", "--working-directory"),
        ("mate-terminal", "--working-directory"),
        ("kitty", "--directory"),
        ("alacritty", "--working-directory"),
    ];
    for (bin, flag) in candidates {
        if Command::new(bin)
            .arg(format!("{}={}", flag, path))
            .spawn()
            .is_ok()
        {
            return Ok(());
        }
    }
    Command::new("xterm")
        .arg("-e")
        .arg(format!("cd {} && bash", path))
        .spawn()
        .map_err(|e| format!("No terminal emulator found: {}", e))?;
    Ok(())
}

#[tauri::command(rename_all = "snake_case")]
fn copy_path(src: String, dst_dir: String) -> Result<String, String> {
    let src_path = PathBuf::from(&src);
    let dst_dir_path = PathBuf::from(&dst_dir);

    if !src_path.exists() {
        return Err(format!("원본이 존재하지 않습니다: {}", src));
    }
    if !dst_dir_path.is_dir() {
        return Err(format!("대상이 디렉토리가 아닙니다: {}", dst_dir));
    }
    if src_path == dst_dir_path || dst_dir_path.starts_with(&src_path) {
        return Err("자기 자신/하위 경로로는 복사할 수 없습니다".to_string());
    }

    let name = src_path
        .file_name()
        .and_then(|n| n.to_str())
        .ok_or_else(|| "잘못된 원본 경로".to_string())?;

    let target = unique_target(&dst_dir_path, name);
    copy_recursive(&src_path, &target).map_err(|e| e.to_string())?;
    Ok(target.to_string_lossy().to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .invoke_handler(tauri::generate_handler![
            list_directory,
            get_home_dir,
            get_parent_dir,
            open_file,
            copy_path,
            rename_path,
            delete_path,
            create_dir,
            open_terminal,
            git_status
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
