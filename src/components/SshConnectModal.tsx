import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  ConnectResult,
  SshAuth,
  sshCancelConnect,
  sshConnect,
} from "../fsApi";

interface Props {
  onClose: () => void;
  onConnected: (result: ConnectResult) => void;
}

type AuthKind = "password" | "key" | "agent";

function parseAddress(addr: string): { user: string; host: string; port: number } | null {
  const trimmed = addr.trim();
  if (!trimmed) return null;
  const atIdx = trimmed.indexOf("@");
  if (atIdx <= 0) return null;
  const user = trimmed.slice(0, atIdx);
  let rest = trimmed.slice(atIdx + 1);
  let port = 22;
  const colonIdx = rest.lastIndexOf(":");
  if (colonIdx > 0 && /^\d+$/.test(rest.slice(colonIdx + 1))) {
    port = parseInt(rest.slice(colonIdx + 1), 10);
    rest = rest.slice(0, colonIdx);
  }
  if (!rest) return null;
  return { user, host: rest, port };
}

export default function SshConnectModal({ onClose, onConnected }: Props) {
  const [address, setAddress] = useState("");
  const [authKind, setAuthKind] = useState<AuthKind>("password");
  const [password, setPassword] = useState("");
  const [keyPath, setKeyPath] = useState("~/.ssh/id_ed25519");
  const [passphrase, setPassphrase] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const attemptIdRef = useRef<string | null>(null);
  const cancelledRef = useRef(false);

  const handleConnect = async () => {
    setError(null);
    const parsed = parseAddress(address);
    if (!parsed) {
      setError("주소 형식: user@host 또는 user@host:port");
      return;
    }
    let auth: SshAuth;
    if (authKind === "password") {
      if (!password) {
        setError("비밀번호를 입력하세요");
        return;
      }
      auth = { kind: "password", password };
    } else if (authKind === "key") {
      if (!keyPath) {
        setError("키 파일 경로를 입력하세요");
        return;
      }
      auth = {
        kind: "key",
        path: keyPath,
        passphrase: passphrase || undefined,
      };
    } else {
      auth = { kind: "agent" };
    }

    const attemptId = crypto.randomUUID();
    attemptIdRef.current = attemptId;
    cancelledRef.current = false;
    setBusy(true);
    try {
      const result = await sshConnect(
        attemptId,
        parsed.host,
        parsed.port,
        parsed.user,
        auth
      );
      if (cancelledRef.current) return;
      onConnected(result);
    } catch (e) {
      if (cancelledRef.current) return;
      const msg = typeof e === "string" ? e : (e as Error)?.message ?? "연결 실패";
      setError(msg);
    } finally {
      attemptIdRef.current = null;
      if (!cancelledRef.current) setBusy(false);
    }
  };

  const handleCancel = () => {
    if (busy && attemptIdRef.current) {
      cancelledRef.current = true;
      const id = attemptIdRef.current;
      void sshCancelConnect(id).catch(() => {});
    }
    onClose();
  };

  return createPortal(
    <div className="modal-backdrop" onClick={handleCancel}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>SSH 연결</h3>
        <label>
          주소
          <input
            autoFocus
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            placeholder="user@host 또는 user@host:port"
            disabled={busy}
          />
          <span className="hint">예: pw@192.168.0.10, root@example.com:2222</span>
        </label>
        <label>
          인증 방식
          <select
            value={authKind}
            onChange={(e) => setAuthKind(e.target.value as AuthKind)}
            disabled={busy}
          >
            <option value="password">비밀번호</option>
            <option value="key">공개키 파일</option>
            <option value="agent">ssh-agent</option>
          </select>
        </label>
        {authKind === "password" && (
          <label>
            비밀번호
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={busy}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleConnect();
              }}
            />
            <span className="hint">세션 메모리에만 보관됩니다.</span>
          </label>
        )}
        {authKind === "key" && (
          <>
            <label>
              키 파일 경로
              <input
                value={keyPath}
                onChange={(e) => setKeyPath(e.target.value)}
                placeholder="/home/user/.ssh/id_ed25519"
                disabled={busy}
              />
              <span className="hint">절대 경로 또는 ~ 로 시작하는 경로</span>
            </label>
            <label>
              Passphrase (있으면)
              <input
                type="password"
                value={passphrase}
                onChange={(e) => setPassphrase(e.target.value)}
                disabled={busy}
              />
            </label>
          </>
        )}
        {authKind === "agent" && (
          <p className="hint">
            ssh-add 로 등록된 키들을 순차 시도합니다. SSH_AUTH_SOCK 환경 변수가
            필요합니다.
          </p>
        )}
        {error && <div className="status-msg error">{error}</div>}
        <div className="modal-buttons">
          <button onClick={handleCancel}>Cancel</button>
          <button className="primary" onClick={handleConnect} disabled={busy}>
            {busy ? "연결 중..." : "Connect"}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
