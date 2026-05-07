# PWFinder

A 4-split file explorer for Linux desktops. Each pane is independent — navigate, color-tag, label, drag-and-drop copy, and check git status. Includes a left-side folder tree and per-pane history. Designed to make multi-folder workflows actually pleasant.

> Built with Rust + Tauri 2 + React. Single native binary, ~10–30 MB RAM, packaged as `.deb` / AppImage.
>
> Named PWFinder so it doesn't collide with macOS Finder when ported.

---

## Features

- **Up to 4 panes** in 6 layouts: Single, Side, Stack, Tri-L, Tri-T, Quad
- **Optional folder tree sidebar** — toggle from the toolbar; click any folder to navigate the active pane
- **Per-pane color and name** — name auto-derives from the current folder, override anytime in Settings
- **Drag-and-drop copy** between panes (recursive for folders, auto-renames on collision)
- **Right-click context menu**: Open, Rename, Copy path, Move to trash
- **Per-pane toggles**:
  - `Hidden` — show/hide dotfiles
  - `Git` — show branch, ahead/behind vs upstream, staged / modified / untracked counts
- **Open terminal** at the current pane's path (`x-terminal-emulator` → `gnome-terminal` → `konsole` → ... → `xterm`)
- **Breadcrumb path** — click any path segment to jump to it
- **Per-pane history** — Back button to revisit prior folders
- **Persistent state** — pane configs, layout, tree visibility, active pane, and window size/position all restored on relaunch

---

## Install

### Option A — `apt install` (recommended, Ubuntu/Debian)

One-time setup. Registers PWFinder as an apt source so `sudo apt upgrade` keeps it updated automatically.

```bash
curl -fsSL https://pinkwink.github.io/finder-pw/pubkey.gpg | sudo gpg --dearmor -o /usr/share/keyrings/pwfinder.gpg
echo "deb [signed-by=/usr/share/keyrings/pwfinder.gpg] https://pinkwink.github.io/finder-pw stable main" | sudo tee /etc/apt/sources.list.d/pwfinder.list
sudo apt update
sudo apt install pwfinder
```

The app will appear in the application launcher (Dash / Activities) as **PWFinder**.

> Maintainer: see [`docs/PUBLISHING.md`](docs/PUBLISHING.md) for the one-time GPG/Pages setup that powers this.

### Option B — pre-built `.deb` (no apt source)

Download `PWFinder_<version>_amd64.deb` from the [Releases](../../releases) page and install:

```bash
sudo dpkg -i PWFinder_*.deb
sudo apt-get install -f      # only if dpkg complains about missing deps
```

### Option C — build from source

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

- **Tauri Linux dependencies** (Ubuntu 22.04+):

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

#### Build

```bash
git clone https://github.com/PinkWink/finder-pw.git
cd finder-pw
npm install
npm run tauri build
```

The `.deb` and AppImage are produced at:

```
src-tauri/target/release/bundle/deb/PWFinder_*.deb
src-tauri/target/release/bundle/appimage/PWFinder_*.AppImage
```

> First build is slow (5–10 min — Tauri compiles ~280 crates). Subsequent builds are seconds.

### Option D — manual desktop entry (no root, after building)

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
| `open_file` | `path` | — (uses `xdg-open`) |
| `copy_path` | `src`, `dst_dir` | created path (recursive copy, unique-name on collision) |
| `rename_path` | `path`, `new_name` | new path |
| `delete_path` | `path` | — (`gio trash` first, falls back to permanent delete) |
| `create_dir` | `parent`, `name` | created path |
| `open_terminal` | `path` | — (tries 8 terminal emulators) |
| `git_status` | `path` | `GitStatus \| null` |

---

## Usage notes

| UI | Action |
|---|---|
| Toolbar `Tree` | Toggle the folder tree sidebar (drives the active pane) |
| Toolbar layout buttons | Switch between 1 / 2 / 3 / 4-pane layouts |
| Click on any pane | Mark it active (its color is shown in the tree highlight) |
| Pane header `Hidden` | Toggle dotfiles in this pane |
| Pane header `Git` | Toggle git status bar in this pane (only renders inside repos) |
| Pane header `▶_` | Open terminal at this pane's path |
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

- [ ] Drag splitter between panes for free resizing
- [ ] Tabs inside each pane
- [ ] In-pane file search / filter
- [ ] Cut / paste (move) in addition to copy
- [ ] Bookmarks sidebar
- [ ] External drag-and-drop (drop from Nautilus / desktop)
- [ ] Configurable git refresh interval
- [ ] Keyboard shortcuts (Ctrl+1…6 for layouts)
- [ ] macOS port (`.dmg`, Homebrew tap)

---

## Tech stack

- **Backend**: Rust 1.75+, Tauri 2.x, `dirs` crate, `tauri-plugin-window-state`
- **Frontend**: React 18, TypeScript 5, Vite 5
- **Bundled font**: [ProggyCrossed](https://github.com/bluescan/proggyfonts) (used for monospaced bits — paths, sizes, dates, git counts)

---

## License

MIT — see [LICENSE](LICENSE).

The bundled ProggyCrossed font is © Tristan Grimmer and distributed under its own MIT-style license. See https://github.com/bluescan/proggyfonts.
