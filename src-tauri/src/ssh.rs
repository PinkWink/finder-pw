use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::sync::RwLock;

use russh::client::{self, Handle};
use russh::keys::ssh_key::PublicKey;
use russh::keys::{load_secret_key, PrivateKeyWithHashAlg};
use russh_sftp::client::fs::Metadata;
use russh_sftp::client::SftpSession;
use russh_sftp::protocol::OpenFlags;
use tokio::sync::oneshot;

pub struct SshHandler;

impl client::Handler for SshHandler {
    type Error = russh::Error;

    async fn check_server_key(
        &mut self,
        _server_public_key: &PublicKey,
    ) -> Result<bool, Self::Error> {
        Ok(true)
    }
}

pub struct SshSession {
    pub handle: Handle<SshHandler>,
    pub sftp: SftpSession,
}

#[derive(Default)]
pub struct SshState {
    sessions: RwLock<HashMap<String, Arc<SshSession>>>,
    pending: RwLock<HashMap<String, oneshot::Sender<()>>>,
}

async fn get_session(state: &SshState, id: &str) -> Result<Arc<SshSession>, String> {
    let map = state.sessions.read().await;
    map.get(id)
        .cloned()
        .ok_or_else(|| format!("세션이 없습니다: {}", id))
}

#[derive(Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum AuthMethod {
    Password { password: String },
    Key { path: String, passphrase: Option<String> },
    Agent,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectResult {
    pub session_id: String,
    pub home_dir: String,
    pub user: String,
    pub host: String,
    pub port: u16,
}

#[derive(Serialize)]
pub struct RemoteEntry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub size: u64,
    pub modified: u64,
}

fn expand_tilde(p: &str) -> PathBuf {
    if let Some(rest) = p.strip_prefix("~/") {
        if let Some(home) = dirs::home_dir() {
            return home.join(rest);
        }
    }
    PathBuf::from(p)
}

fn join_remote(parent: &str, name: &str) -> String {
    if parent == "/" {
        format!("/{}", name)
    } else if parent.ends_with('/') {
        format!("{}{}", parent, name)
    } else {
        format!("{}/{}", parent, name)
    }
}

fn entry_from(path: &str, name: String, meta: &Metadata) -> RemoteEntry {
    let full = join_remote(path, &name);
    RemoteEntry {
        name,
        path: full,
        is_dir: meta.is_dir(),
        size: meta.size.unwrap_or(0),
        modified: meta.mtime.unwrap_or(0) as u64,
    }
}

async fn perform_connect(
    host: String,
    port: u16,
    user: String,
    auth: AuthMethod,
) -> Result<(Handle<SshHandler>, SftpSession, String), String> {
    let config = Arc::new(client::Config {
        inactivity_timeout: Some(std::time::Duration::from_secs(120)),
        ..Default::default()
    });

    let mut session = client::connect(config, (host.as_str(), port), SshHandler)
        .await
        .map_err(|e| format!("연결 실패: {}", e))?;

    let auth_ok = match auth {
        AuthMethod::Password { password } => session
            .authenticate_password(&user, password)
            .await
            .map_err(|e| format!("인증 실패: {}", e))?
            .success(),
        AuthMethod::Key { path, passphrase } => {
            let resolved = expand_tilde(&path);
            let key = load_secret_key(&resolved, passphrase.as_deref())
                .map_err(|e| format!("키 로드 실패 ({}): {}", resolved.display(), e))?;
            let hash = session
                .best_supported_rsa_hash()
                .await
                .map_err(|e| format!("RSA 해시 협상 실패: {}", e))?
                .flatten();
            session
                .authenticate_publickey(
                    &user,
                    PrivateKeyWithHashAlg::new(Arc::new(key), hash),
                )
                .await
                .map_err(|e| format!("키 인증 실패: {}", e))?
                .success()
        }
        AuthMethod::Agent => {
            let mut agent = russh::keys::agent::client::AgentClient::connect_env()
                .await
                .map_err(|e| format!("ssh-agent 연결 실패: {}", e))?;
            let identities = agent
                .request_identities()
                .await
                .map_err(|e| format!("agent 키 조회 실패: {}", e))?;
            if identities.is_empty() {
                return Err("ssh-agent에 키가 없습니다".to_string());
            }
            let mut ok = false;
            for ident in identities {
                let hash = session
                    .best_supported_rsa_hash()
                    .await
                    .map_err(|e| format!("RSA 해시 협상 실패: {}", e))?
                    .flatten();
                let pk: PublicKey = ident.public_key().into_owned();
                let res = session
                    .authenticate_publickey_with(&user, pk, hash, &mut agent)
                    .await
                    .map_err(|e| format!("agent 인증 실패: {}", e))?;
                if res.success() {
                    ok = true;
                    break;
                }
            }
            ok
        }
    };

    if !auth_ok {
        return Err("인증 거부됨".to_string());
    }

    let channel = session
        .channel_open_session()
        .await
        .map_err(|e| format!("SFTP 채널 실패: {}", e))?;
    channel
        .request_subsystem(true, "sftp")
        .await
        .map_err(|e| format!("SFTP 서브시스템 요청 실패: {}", e))?;
    let sftp = SftpSession::new(channel.into_stream())
        .await
        .map_err(|e| format!("SFTP 세션 초기화 실패: {}", e))?;

    let home_dir = sftp
        .canonicalize(".")
        .await
        .map_err(|e| format!("홈 경로 조회 실패: {}", e))?;

    Ok((session, sftp, home_dir))
}

#[tauri::command(rename_all = "snake_case")]
pub async fn ssh_connect(
    attempt_id: String,
    host: String,
    port: u16,
    user: String,
    auth: AuthMethod,
    state: tauri::State<'_, SshState>,
) -> Result<ConnectResult, String> {
    let (cancel_tx, cancel_rx) = oneshot::channel::<()>();
    state
        .pending
        .write()
        .await
        .insert(attempt_id.clone(), cancel_tx);

    let work = perform_connect(host.clone(), port, user.clone(), auth);
    tokio::pin!(work);

    let outcome = tokio::select! {
        r = &mut work => r,
        _ = cancel_rx => Err("취소됨".to_string()),
    };

    state.pending.write().await.remove(&attempt_id);

    let (session, sftp, home_dir) = outcome?;

    let session_id = uuid::Uuid::new_v4().to_string();
    let s = Arc::new(SshSession {
        handle: session,
        sftp,
    });
    state.sessions.write().await.insert(session_id.clone(), s);

    Ok(ConnectResult {
        session_id,
        home_dir,
        user,
        host,
        port,
    })
}

#[tauri::command(rename_all = "snake_case")]
pub async fn ssh_cancel_connect(
    attempt_id: String,
    state: tauri::State<'_, SshState>,
) -> Result<(), String> {
    if let Some(tx) = state.pending.write().await.remove(&attempt_id) {
        let _ = tx.send(());
    }
    Ok(())
}

#[tauri::command(rename_all = "snake_case")]
pub async fn ssh_disconnect(
    session_id: String,
    state: tauri::State<'_, SshState>,
) -> Result<(), String> {
    let mut map = state.sessions.write().await;
    if let Some(s) = map.remove(&session_id) {
        let _ = s.sftp.close().await;
        if let Some(inner) = Arc::into_inner(s) {
            let handle = inner.handle;
            let _ = handle
                .disconnect(russh::Disconnect::ByApplication, "", "en")
                .await;
        }
    }
    Ok(())
}

#[tauri::command(rename_all = "snake_case")]
pub async fn ssh_list_directory(
    session_id: String,
    path: String,
    state: tauri::State<'_, SshState>,
) -> Result<Vec<RemoteEntry>, String> {
    let s = get_session(&state, &session_id).await?;
    let dir = s
        .sftp
        .read_dir(&path)
        .await
        .map_err(|e| format!("{}: {}", path, e))?;
    let mut out = Vec::new();
    for entry in dir {
        let name = entry.file_name();
        if name == "." || name == ".." {
            continue;
        }
        let meta = entry.metadata();
        out.push(entry_from(&path, name, &meta));
    }
    out.sort_by(|a, b| {
        b.is_dir
            .cmp(&a.is_dir)
            .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });
    Ok(out)
}

#[tauri::command(rename_all = "snake_case")]
pub async fn ssh_create_dir(
    session_id: String,
    parent: String,
    name: String,
    state: tauri::State<'_, SshState>,
) -> Result<String, String> {
    if name.is_empty() || name.contains('/') {
        return Err("이름이 비었거나 슬래시를 포함합니다".to_string());
    }
    let s = get_session(&state, &session_id).await?;
    let target = join_remote(&parent, &name);
    if s.sftp.try_exists(&target).await.unwrap_or(false) {
        return Err(format!("이미 존재: {}", name));
    }
    s.sftp
        .create_dir(&target)
        .await
        .map_err(|e| format!("폴더 생성 실패: {}", e))?;
    Ok(target)
}

#[tauri::command(rename_all = "snake_case")]
pub async fn ssh_rename(
    session_id: String,
    path: String,
    new_name: String,
    state: tauri::State<'_, SshState>,
) -> Result<String, String> {
    if new_name.is_empty() || new_name.contains('/') {
        return Err("이름이 비었거나 슬래시를 포함합니다".to_string());
    }
    let s = get_session(&state, &session_id).await?;
    let parent = match path.rsplit_once('/') {
        Some((p, _)) if !p.is_empty() => p.to_string(),
        _ => "/".to_string(),
    };
    let new_path = join_remote(&parent, &new_name);
    if s.sftp.try_exists(&new_path).await.unwrap_or(false) {
        return Err(format!("이미 존재: {}", new_name));
    }
    s.sftp
        .rename(&path, &new_path)
        .await
        .map_err(|e| format!("이름 변경 실패: {}", e))?;
    Ok(new_path)
}

async fn ssh_remove_recursive(sftp: &SftpSession, path: &str) -> Result<(), String> {
    let meta = sftp
        .symlink_metadata(path)
        .await
        .map_err(|e| format!("{}: {}", path, e))?;
    if meta.is_dir() {
        let entries = sftp
            .read_dir(path)
            .await
            .map_err(|e| format!("{}: {}", path, e))?;
        for entry in entries {
            let name = entry.file_name();
            if name == "." || name == ".." {
                continue;
            }
            let child = join_remote(path, &name);
            Box::pin(ssh_remove_recursive(sftp, &child)).await?;
        }
        sftp.remove_dir(path)
            .await
            .map_err(|e| format!("폴더 삭제 실패 {}: {}", path, e))?;
    } else {
        sftp.remove_file(path)
            .await
            .map_err(|e| format!("파일 삭제 실패 {}: {}", path, e))?;
    }
    Ok(())
}

#[tauri::command(rename_all = "snake_case")]
pub async fn ssh_delete(
    session_id: String,
    path: String,
    state: tauri::State<'_, SshState>,
) -> Result<(), String> {
    let s = get_session(&state, &session_id).await?;
    ssh_remove_recursive(&s.sftp, &path).await
}

#[tauri::command(rename_all = "snake_case")]
pub async fn ssh_get_parent_dir(path: String) -> Option<String> {
    if path == "/" || path.is_empty() {
        return None;
    }
    match path.rsplit_once('/') {
        Some(("", _)) => Some("/".to_string()),
        Some((p, _)) => Some(p.to_string()),
        None => None,
    }
}

fn unique_local_target(dst_dir: &Path, name: &str) -> PathBuf {
    let candidate = dst_dir.join(name);
    if !candidate.exists() {
        return candidate;
    }
    let p = Path::new(name);
    let stem = p.file_stem().and_then(|s| s.to_str()).unwrap_or(name);
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

async fn unique_remote_target(sftp: &SftpSession, dst_dir: &str, name: &str) -> String {
    let candidate = join_remote(dst_dir, name);
    if !sftp.try_exists(&candidate).await.unwrap_or(false) {
        return candidate;
    }
    let p = Path::new(name);
    let stem = p.file_stem().and_then(|s| s.to_str()).unwrap_or(name);
    let ext = p.extension().and_then(|s| s.to_str());
    for i in 1..1000 {
        let new_name = match ext {
            Some(e) => format!("{} (copy {}).{}", stem, i, e),
            None => format!("{} (copy {})", stem, i),
        };
        let candidate = join_remote(dst_dir, &new_name);
        if !sftp.try_exists(&candidate).await.unwrap_or(false) {
            return candidate;
        }
    }
    join_remote(dst_dir, &format!("{}_copy", name))
}

async fn upload_file(sftp: &SftpSession, src: &Path, dst: &str) -> Result<(), String> {
    let mut file = tokio::fs::File::open(src)
        .await
        .map_err(|e| format!("로컬 파일 열기 실패 {:?}: {}", src, e))?;
    let mut remote = sftp
        .open_with_flags(
            dst,
            OpenFlags::CREATE | OpenFlags::TRUNCATE | OpenFlags::WRITE,
        )
        .await
        .map_err(|e| format!("원격 파일 생성 실패 {}: {}", dst, e))?;
    let mut buf = vec![0u8; 64 * 1024];
    loop {
        let n = file
            .read(&mut buf)
            .await
            .map_err(|e| format!("로컬 읽기 실패: {}", e))?;
        if n == 0 {
            break;
        }
        remote
            .write_all(&buf[..n])
            .await
            .map_err(|e| format!("원격 쓰기 실패 {}: {}", dst, e))?;
    }
    remote
        .shutdown()
        .await
        .map_err(|e| format!("원격 닫기 실패 {}: {}", dst, e))?;
    Ok(())
}

async fn upload_recursive(sftp: &SftpSession, src: &Path, dst: &str) -> Result<(), String> {
    if src.is_dir() {
        if !sftp.try_exists(dst).await.unwrap_or(false) {
            sftp.create_dir(dst)
                .await
                .map_err(|e| format!("원격 폴더 생성 실패 {}: {}", dst, e))?;
        }
        let mut rd = tokio::fs::read_dir(src)
            .await
            .map_err(|e| format!("로컬 디렉토리 읽기 실패 {:?}: {}", src, e))?;
        while let Some(entry) = rd
            .next_entry()
            .await
            .map_err(|e| format!("로컬 디렉토리 읽기 실패: {}", e))?
        {
            let name = entry.file_name().to_string_lossy().to_string();
            let child_dst = join_remote(dst, &name);
            Box::pin(upload_recursive(sftp, &entry.path(), &child_dst)).await?;
        }
    } else {
        upload_file(sftp, src, dst).await?;
    }
    Ok(())
}

async fn download_file(sftp: &SftpSession, src: &str, dst: &Path) -> Result<(), String> {
    let mut remote = sftp
        .open(src)
        .await
        .map_err(|e| format!("원격 파일 열기 실패 {}: {}", src, e))?;
    let mut local = tokio::fs::File::create(dst)
        .await
        .map_err(|e| format!("로컬 파일 생성 실패 {:?}: {}", dst, e))?;
    let mut buf = vec![0u8; 64 * 1024];
    loop {
        let n = remote
            .read(&mut buf)
            .await
            .map_err(|e| format!("원격 읽기 실패 {}: {}", src, e))?;
        if n == 0 {
            break;
        }
        local
            .write_all(&buf[..n])
            .await
            .map_err(|e| format!("로컬 쓰기 실패: {}", e))?;
    }
    local
        .flush()
        .await
        .map_err(|e| format!("로컬 flush 실패: {}", e))?;
    Ok(())
}

async fn download_recursive(sftp: &SftpSession, src: &str, dst: &Path) -> Result<(), String> {
    let meta = sftp
        .metadata(src)
        .await
        .map_err(|e| format!("원격 stat 실패 {}: {}", src, e))?;
    if meta.is_dir() {
        tokio::fs::create_dir_all(dst)
            .await
            .map_err(|e| format!("로컬 폴더 생성 실패 {:?}: {}", dst, e))?;
        let entries = sftp
            .read_dir(src)
            .await
            .map_err(|e| format!("원격 디렉토리 읽기 실패 {}: {}", src, e))?;
        for entry in entries {
            let name = entry.file_name();
            if name == "." || name == ".." {
                continue;
            }
            let child_src = join_remote(src, &name);
            let child_dst = dst.join(&name);
            Box::pin(download_recursive(sftp, &child_src, &child_dst)).await?;
        }
    } else {
        download_file(sftp, src, dst).await?;
    }
    Ok(())
}

#[tauri::command(rename_all = "snake_case")]
pub async fn ssh_copy_to_remote(
    session_id: String,
    src: String,
    dst_dir: String,
    state: tauri::State<'_, SshState>,
) -> Result<String, String> {
    let s = get_session(&state, &session_id).await?;
    let src_path = PathBuf::from(&src);
    if !src_path.exists() {
        return Err(format!("원본이 존재하지 않습니다: {}", src));
    }
    let dst_meta = s
        .sftp
        .metadata(&dst_dir)
        .await
        .map_err(|e| format!("대상 조회 실패 {}: {}", dst_dir, e))?;
    if !dst_meta.is_dir() {
        return Err(format!("대상이 디렉토리가 아닙니다: {}", dst_dir));
    }
    let name = src_path
        .file_name()
        .and_then(|n| n.to_str())
        .ok_or_else(|| "잘못된 원본 경로".to_string())?;
    let target = unique_remote_target(&s.sftp, &dst_dir, name).await;
    upload_recursive(&s.sftp, &src_path, &target).await?;
    Ok(target)
}

#[tauri::command(rename_all = "snake_case")]
pub async fn ssh_copy_from_remote(
    session_id: String,
    src: String,
    dst_dir: String,
    state: tauri::State<'_, SshState>,
) -> Result<String, String> {
    let s = get_session(&state, &session_id).await?;
    let dst_dir_path = PathBuf::from(&dst_dir);
    if !dst_dir_path.is_dir() {
        return Err(format!("대상이 디렉토리가 아닙니다: {}", dst_dir));
    }
    let _ = s
        .sftp
        .metadata(&src)
        .await
        .map_err(|e| format!("원본 조회 실패 {}: {}", src, e))?;
    let name = src
        .rsplit('/')
        .next()
        .filter(|n| !n.is_empty())
        .ok_or_else(|| "잘못된 원본 경로".to_string())?
        .to_string();
    let target = unique_local_target(&dst_dir_path, &name);
    download_recursive(&s.sftp, &src, &target).await?;
    Ok(target.to_string_lossy().to_string())
}

#[tauri::command(rename_all = "snake_case")]
pub async fn ssh_copy_remote_to_remote(
    src_session_id: String,
    src: String,
    dst_session_id: String,
    dst_dir: String,
    state: tauri::State<'_, SshState>,
) -> Result<String, String> {
    let src_s = get_session(&state, &src_session_id).await?;
    let dst_s = get_session(&state, &dst_session_id).await?;
    let dst_meta = dst_s
        .sftp
        .metadata(&dst_dir)
        .await
        .map_err(|e| format!("대상 조회 실패 {}: {}", dst_dir, e))?;
    if !dst_meta.is_dir() {
        return Err(format!("대상이 디렉토리가 아닙니다: {}", dst_dir));
    }
    let name = src
        .rsplit('/')
        .next()
        .filter(|n| !n.is_empty())
        .ok_or_else(|| "잘못된 원본 경로".to_string())?
        .to_string();

    if src_session_id == dst_session_id {
        let target = unique_remote_target(&src_s.sftp, &dst_dir, &name).await;
        copy_within_remote(&src_s.sftp, &src, &target).await?;
        return Ok(target);
    }

    let tmp = tempdir_for_transfer()?;
    let local_buf = tmp.join(&name);
    download_recursive(&src_s.sftp, &src, &local_buf).await?;
    let target = unique_remote_target(&dst_s.sftp, &dst_dir, &name).await;
    let res = upload_recursive(&dst_s.sftp, &local_buf, &target).await;
    let _ = std::fs::remove_dir_all(&tmp);
    res?;
    Ok(target)
}

async fn copy_within_remote(sftp: &SftpSession, src: &str, dst: &str) -> Result<(), String> {
    let meta = sftp
        .metadata(src)
        .await
        .map_err(|e| format!("원본 조회 실패 {}: {}", src, e))?;
    if meta.is_dir() {
        sftp.create_dir(dst)
            .await
            .map_err(|e| format!("원격 폴더 생성 실패 {}: {}", dst, e))?;
        let entries = sftp
            .read_dir(src)
            .await
            .map_err(|e| format!("원격 디렉토리 읽기 실패 {}: {}", src, e))?;
        for entry in entries {
            let name = entry.file_name();
            if name == "." || name == ".." {
                continue;
            }
            let child_src = join_remote(src, &name);
            let child_dst = join_remote(dst, &name);
            Box::pin(copy_within_remote(sftp, &child_src, &child_dst)).await?;
        }
    } else {
        let data = sftp
            .read(src)
            .await
            .map_err(|e| format!("원격 읽기 실패 {}: {}", src, e))?;
        sftp.write(dst, &data)
            .await
            .map_err(|e| format!("원격 쓰기 실패 {}: {}", dst, e))?;
    }
    Ok(())
}

fn tempdir_for_transfer() -> Result<PathBuf, String> {
    let base = std::env::temp_dir().join(format!(
        "pwfinder-xfer-{}",
        uuid::Uuid::new_v4().simple()
    ));
    std::fs::create_dir_all(&base).map_err(|e| format!("임시 폴더 생성 실패: {}", e))?;
    Ok(base)
}

#[tauri::command(rename_all = "snake_case")]
pub async fn ssh_open_file(
    session_id: String,
    path: String,
    state: tauri::State<'_, SshState>,
) -> Result<(), String> {
    let s = get_session(&state, &session_id).await?;
    let name = path
        .rsplit('/')
        .next()
        .filter(|n| !n.is_empty())
        .ok_or_else(|| "잘못된 경로".to_string())?;
    let dir = std::env::temp_dir().join(format!(
        "pwfinder-open-{}",
        uuid::Uuid::new_v4().simple()
    ));
    std::fs::create_dir_all(&dir).map_err(|e| format!("임시 폴더 생성 실패: {}", e))?;
    let local = dir.join(name);
    download_file(&s.sftp, &path, &local).await?;
    crate::open_with_smart_opener(&local)
}
