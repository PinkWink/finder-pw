# PWFinder

A 4-split file explorer for **Linux and macOS** desktops. Each pane is independent — navigate, color-tag, label, drag-and-drop copy, and check git status. Includes a left-side folder tree and per-pane history. Designed to make multi-folder workflows actually pleasant.

> Built with Rust + Tauri 2 + React. Single native binary, ~10–30 MB RAM. Packaged as `.deb` / AppImage on Linux (amd64 and arm64) and `.dmg` on macOS (Apple Silicon).

---

## Features

- **Up to 4 panes** in 6 layouts: Single, Side, Stack, Tri-L, Tri-T, Quad
- **Optional folder tree sidebar** — toggle from the toolbar; click any folder to navigate the active pane
- **Per-pane color and name** — name auto-derives from the current folder, override anytime in Settings
- **Drag-and-drop copy** between panes (recursive for folders, auto-renames on collision)
- **SSH/SFTP remote panes** — `🌐` button on any pane connects to `user@host[:port]` (password / private key / ssh-agent). Drag-drop between local and remote (and remote ↔ remote) works just like local copies; remote files double-click into a temp folder and open with the right local app
- **Right-click context menu**: Open, Rename, Copy path, Move to trash
- **Per-pane toggles**:
  - `Hidden` — show/hide dotfiles
  - `Git` — show branch, ahead/behind vs upstream, staged / modified / untracked counts (local panes)
- **Open terminal** at the current pane's path (`x-terminal-emulator` → `gnome-terminal` → `konsole` → ... → `xterm`)
- **Breadcrumb path** — click any path segment to jump to it
- **Per-pane history** — Back button to revisit prior folders
- **Persistent state** — pane configs, layout, tree visibility, active pane, and window size/position all restored on relaunch (SSH sessions are intentionally not persisted — reconnect on next launch)

---

## Install

### Linux — `apt install` (Ubuntu/Debian, recommended)

One-time setup. Registers PWFinder as an apt source so `sudo apt upgrade` keeps it updated automatically. Works on both **amd64** (regular PC) and **arm64** (Raspberry Pi, Apple Silicon Parallels VM, etc.) — apt picks the right one for your machine.

```bash
curl -fsSL https://pinkwink.github.io/finder-pw/pubkey.gpg | sudo gpg --dearmor -o /usr/share/keyrings/pwfinder.gpg
echo "deb [signed-by=/usr/share/keyrings/pwfinder.gpg] https://pinkwink.github.io/finder-pw stable main" | sudo tee /etc/apt/sources.list.d/pwfinder.list
sudo apt update
sudo apt install pw-finder
```

The app will appear in the application launcher (Dash / Activities) as **PWFinder**.

> Maintainer: see [`docs/PUBLISHING.md`](docs/PUBLISHING.md) for the one-time GPG/Pages setup that powers this.

### Linux — pre-built `.deb` / AppImage (no apt source)

Download the `.deb` (or `.AppImage`) for your architecture from the [Releases](../../releases) page:

- `PWFinder_<version>_amd64.deb` — regular x86_64 PC
- `PWFinder_<version>_arm64.deb` — aarch64 (Raspberry Pi, Apple Silicon Parallels VM, etc.)

Check your arch with `dpkg --print-architecture` if unsure.

```bash
sudo dpkg -i PWFinder_*.deb
sudo apt-get install -f      # only if dpkg complains about missing deps
```

### macOS — `.dmg` (Apple Silicon)

Download `PWFinder_<version>_aarch64.dmg` from the [Releases](../../releases) page, open the disk image, drag **PWFinder.app** to `/Applications`.

> ⚠️ **First open**: Because we don't have an Apple Developer code-signing cert yet, macOS Gatekeeper will refuse to launch on double-click. The first time, **right-click PWFinder in Applications → Open → Open** in the dialog. After this once, it launches normally.
>
> Intel-Mac users can still build from source (Option below) — pre-built binary is currently arm64 only.

### Build from source (any platform)

#### Prerequisites

- **Rust** (stable): https://rustup.rs

  ```bash
  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
  source $HOME/.cargo/env
  ```

- **Node.js LTS**, e.g. via [nvm](https://github.com/nvm-sh/nvm):

  ```bash
  curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
  export NVM_DIR="$HOME/.nvm" && \. "$NVM_DIR/nvm.sh"
  nvm install --lts
  ```

- **Tauri Linux dependencies** (Ubuntu 22.04+, only on Linux):

  ```bash
  sudo apt install \
    libwebkit2gtk-4.1-dev \
    build-essential \
    libxdo-dev \
    libssl-dev \
    libayatana-appindicator3-dev \
    librsvg2-dev \
    pkg-config
  ```

- **macOS dependencies**: just Xcode Command Line Tools — `xcode-select --install`

#### Build

```bash
git clone https://github.com/PinkWink/finder-pw.git
cd finder-pw
npm install
npm run tauri build
```

Artifacts are produced at (architecture matches the machine you're building on — amd64 or arm64 on Linux):

```
# Linux
src-tauri/target/release/bundle/deb/PWFinder_*.deb
src-tauri/target/release/bundle/appimage/PWFinder_*.AppImage

# macOS
src-tauri/target/release/bundle/dmg/PWFinder_*.dmg
src-tauri/target/release/bundle/macos/PWFinder.app
```

> First build is slow (5–10 min — Tauri compiles ~280 crates). Subsequent builds are seconds.

### Linux — manual desktop entry (no root, after building)

If you'd rather not `dpkg -i`, after `npm run tauri build`:

```bash
# Copy binary somewhere on PATH (or leave at target/release)
mkdir -p ~/.local/bin
cp src-tauri/target/release/pwfinder ~/.local/bin/

# Copy icon
mkdir -p ~/.local/share/icons/hicolor/512x512/apps
cp src-tauri/icons/icon.png ~/.local/share/icons/hicolor/512x512/apps/pwfinder.png

# Install desktop entry
mkdir -p ~/.local/share/applications
sed \
  -e "s|__BIN__|$HOME/.local/bin/pwfinder|" \
  -e "s|__ICON__|pwfinder|" \
  assets/pwfinder.desktop > ~/.local/share/applications/pwfinder.desktop

# Refresh Dash cache
update-desktop-database ~/.local/share/applications 2>/dev/null || true
```

The PWFinder entry will appear in Dash within a few seconds.

---

## Development

```bash
npm install
npm run tauri dev
```

- Frontend hot-reloads on save (Vite at `localhost:1420`).
- Rust changes in `src-tauri/src/` trigger an automatic recompile + window restart.

### Project structure

```
finder-pw/
├── src/                      # React + TypeScript frontend
│   ├── App.tsx               # Layout, pane state, localStorage persistence
│   ├── App.css               # Light theme + ProggyCrossed font for monospaced bits
│   ├── types.ts
│   └── components/
│       ├── Toolbar.tsx       # Tree toggle + 6 layout buttons
│       ├── TreeSidebar.tsx   # Lazy-loading folder tree
│       ├── Pane.tsx          # Single pane (header, breadcrumb, git bar, file list, drag/drop)
│       ├── FileList.tsx      # File rows
│       ├── PaneSettings.tsx  # Name / path / color modal
│       └── ContextMenu.tsx   # Right-click menu primitive
├── src-tauri/                # Rust backend
│   ├── src/
│   │   ├── main.rs
│   │   └── lib.rs            # All #[tauri::command] handlers
│   ├── icons/                # 32 / 128 / 256 / 512 PNG
│   └── tauri.conf.json
├── public/fonts/             # ProggyCrossed-Regular.ttf
├── assets/pwfinder.desktop   # Manual install template
└── package.json
```

### Backend commands

| Command | Args | Returns |
|---|---|---|
| `list_directory` | `path` | `FileEntry[]` |
| `get_home_dir` | — | `String` |
| `get_parent_dir` | `path` | `String \| null` |
| `open_file` | `path` | — (smart opener: browser for html/pdf/svg, else `xdg-open`) |
| `copy_path` | `src`, `dst_dir` | created path (recursive copy, unique-name on collision) |
| `rename_path` | `path`, `new_name` | new path |
| `delete_path` | `path` | — (`gio trash` first, falls back to permanent delete) |
| `create_dir` | `parent`, `name` | created path |
| `open_terminal` | `path` | — (tries 8 terminal emulators) |
| `git_status` | `path` | `GitStatus \| null` |
| `ssh_connect` | `attempt_id`, `host`, `port`, `user`, `auth` | `{ session_id, home_dir, user, host, port }` |
| `ssh_cancel_connect` | `attempt_id` | — (cancels in-flight connect via `tokio::select!` + oneshot) |
| `ssh_disconnect` | `session_id` | — |
| `ssh_list_directory` | `session_id`, `path` | `FileEntry[]` |
| `ssh_get_parent_dir` | `path` | `String \| null` |
| `ssh_create_dir` | `session_id`, `parent`, `name` | created path |
| `ssh_rename` | `session_id`, `path`, `new_name` | new path |
| `ssh_delete` | `session_id`, `path` | — (recursive) |
| `ssh_open_file` | `session_id`, `path` | — (downloads to temp, then smart opener) |
| `ssh_copy_to_remote` | `session_id`, `src`, `dst_dir` | created path (local → remote, recursive) |
| `ssh_copy_from_remote` | `session_id`, `src`, `dst_dir` | created path (remote → local, recursive) |
| `ssh_copy_remote_to_remote` | `src_session_id`, `src`, `dst_session_id`, `dst_dir` | created path (same session = SFTP-internal; cross-session = via local temp) |

---

## Usage notes

| UI | Action |
|---|---|
| Toolbar `Tree` | Toggle the folder tree sidebar (drives the active pane) |
| Toolbar layout buttons | Switch between 1 / 2 / 3 / 4-pane layouts |
| Click on any pane | Mark it active (its color is shown in the tree highlight) |
| Pane header `Hidden` | Toggle dotfiles in this pane |
| Pane header `Git` | Toggle git status bar in this pane (only renders inside repos; hidden in remote mode) |
| Pane header `▶_` | Open terminal at this pane's path (local panes only) |
| Pane header `🌐` | Connect this pane via SSH (user@host[:port], password / key / ssh-agent) |
| Pane header `⏏` | Disconnect SSH and return this pane to local mode |
| Pane header `←` / `↑` / `⟳` / `⚙` | Back (history) / parent folder / refresh / pane settings |
| Breadcrumb segment | Jump to that ancestor path |
| Double-click file | Open in default app |
| Double-click folder | Enter folder |
| Drag file → other pane | Copy (recursive for folders) |
| Right-click file | Open / Rename / Copy path / Move to trash |

### Git status legend

```
⎇ main  ↑3  ↓1  +2  ~5  ?7
```

- `↑n` ahead of upstream — `↓n` behind upstream — `no upstream` if no tracking branch
- `+n` staged — `~n` modified (unstaged) — `?n` untracked
- `✓ clean` when nothing to commit

---

## Roadmap

- [x] macOS port (`.dmg`, arm64) — v0.2.0
- [x] Drag splitter between panes for free resizing — v0.3.0
- [x] SSH/SFTP remote panes with bidirectional drag-drop copy — v0.4.0
- [ ] SSH known_hosts verification (currently auto-accepts)
- [ ] Saved SSH connections / favorites
- [ ] Detailed copy progress (file count + bytes via Tauri events)
- [ ] macOS code signing + notarization (smooth first-open)
- [ ] Universal binary (Intel + Apple Silicon) for macOS
- [ ] Homebrew tap for `brew install --cask pwfinder`
- [ ] Tabs inside each pane
- [ ] In-pane file search / filter
- [ ] Cut / paste (move) in addition to copy
- [ ] Bookmarks sidebar
- [ ] External drag-and-drop (drop from Nautilus / Finder / desktop)
- [ ] Configurable git refresh interval
- [ ] Keyboard shortcuts (Ctrl+1…6 for layouts)
- [ ] Windows port (`.msi`)

---

## YOUTUBE Link
https://www.youtube.com/watch?v=1sx66-85bYk

---

## Tech stack

- **Backend**: Rust 1.85+, Tauri 2.x, `dirs`, `tauri-plugin-window-state`, `russh` + `russh-sftp` (SSH/SFTP), `tokio`
- **Frontend**: React 18, TypeScript 5, Vite 5
- **Bundled font**: [ProggyCrossed](https://github.com/bluescan/proggyfonts) (used for monospaced bits — paths, sizes, dates, git counts)

---

## License

MIT — see [LICENSE](LICENSE).

The bundled ProggyCrossed font is © Tristan Grimmer and distributed under its own MIT-style license. See https://github.com/bluescan/proggyfonts.
