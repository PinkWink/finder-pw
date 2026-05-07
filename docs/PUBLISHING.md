# Publishing the APT repository

This document is for **maintainers**. End-users only need the one-liner in [README.md](../README.md#install).

When you push a `v*` tag, GitHub Actions will:
1. Build the `.deb` and `.AppImage` from source
2. Attach them to a GitHub Release
3. Add the `.deb` to a self-hosted APT repository at `https://pinkwink.github.io/finder-pw/`
4. Sign the repository metadata with your GPG key

## One-time setup

### 1. Generate a GPG signing key

On your local machine:

```bash
gpg --quick-generate-key "Finder Repo <you@example.com>" rsa4096 sign 2y
```

Capture the long key ID:

```bash
gpg --list-secret-keys --keyid-format=long "you@example.com"
# look for "sec   rsa4096/<KEY_ID>"
```

Export the **secret** key (this is the one that signs releases — keep it private):

```bash
gpg --armor --export-secret-keys <KEY_ID> > finder-signing.key.asc
```

### 2. Add GitHub secrets

In your repo: **Settings → Secrets and variables → Actions → New repository secret**

| Name | Value |
|---|---|
| `GPG_KEY_ID` | the long key ID from step 1 |
| `GPG_PRIVATE_KEY` | the entire contents of `finder-signing.key.asc` |
| `GPG_PASSPHRASE` | the passphrase if you set one (otherwise omit) |

After adding, **delete the local `finder-signing.key.asc` file** (or store it somewhere safe — you'll need it if you ever migrate).

### 3. Enable GitHub Pages

1. Push a placeholder `gh-pages` branch (so Pages has something to serve initially):
   ```bash
   git checkout --orphan gh-pages
   git rm -rf .
   echo "# APT repo coming soon" > README.md
   git add README.md
   git commit -m "Initial gh-pages"
   git push origin gh-pages
   git checkout main
   ```
2. **Settings → Pages**: Source = **Deploy from a branch**, Branch = **gh-pages** / **/(root)**.
3. Wait ~30 seconds, the URL `https://pinkwink.github.io/finder-pw/` should serve.

### 4. Verify the workflow file

Check that `.github/workflows/release.yml` is on `main`. The `apt-repo` job will run on `v*` tags and on manual dispatch.

## Per-release flow

```bash
# 1. Bump version in three places
#    - package.json:           "version": "0.1.1"
#    - src-tauri/Cargo.toml:    version = "0.1.1"
#    - src-tauri/tauri.conf.json: "version": "0.1.1"

# 2. Commit, tag, push
git add -u
git commit -m "Release v0.1.1"
git tag v0.1.1
git push origin main v0.1.1
```

GitHub Actions will:
- Build the `.deb` (~5–10 min on the runner)
- Add it to the APT repo on `gh-pages`
- Re-sign metadata
- Publish

## End-user install one-liner

(This is also documented in `index.html` of the published Pages site.)

```bash
curl -fsSL https://pinkwink.github.io/finder-pw/pubkey.gpg | sudo gpg --dearmor -o /usr/share/keyrings/finder.gpg
echo "deb [signed-by=/usr/share/keyrings/finder.gpg] https://pinkwink.github.io/finder-pw stable main" | sudo tee /etc/apt/sources.list.d/finder.list
sudo apt update
sudo apt install finder
```

After this, `sudo apt upgrade` will pick up future releases automatically.

## Local testing of the script

You can build the repo locally before pushing to GitHub:

```bash
sudo apt install dpkg-dev gnupg
export GPG_KEY_ID=<your-key-id>
npm run tauri build
./scripts/build-apt-repo.sh /tmp/finder-repo \
  src-tauri/target/release/bundle/deb/*.deb

# Inspect
tree /tmp/finder-repo
cat /tmp/finder-repo/dists/stable/Release
```

You can also test the install on a throwaway VM by serving it:

```bash
cd /tmp/finder-repo
python3 -m http.server 8080
# In another shell / VM:
curl -fsSL http://localhost:8080/pubkey.gpg | sudo gpg --dearmor -o /usr/share/keyrings/finder.gpg
echo "deb [signed-by=/usr/share/keyrings/finder.gpg] http://localhost:8080 stable main" | sudo tee /etc/apt/sources.list.d/finder.list
sudo apt update
sudo apt install finder
```

## Troubleshooting

**`apt update` complains about expired/invalid signatures**

The `Release` file has a `Date:` field but no `Valid-Until`. If you want signatures to expire, add a `Valid-Until` field in `build-apt-repo.sh`. For most use cases, no expiry is fine.

**`apt update` says `404 Not Found` for `Packages`**

GitHub Pages caches aggressively. After publishing, wait 1–2 minutes, then `sudo apt update` again. If still 404, check Actions logs and verify `apt-repo/dists/stable/main/binary-amd64/Packages` exists in the `gh-pages` branch.

**GPG `gpg: signing failed: Inappropriate ioctl for device`**

The key has a passphrase but `--pinentry-mode loopback` wasn't applied. Make sure `GPG_PASSPHRASE` is set in GitHub Secrets.

**Want to remove an old version**

Edit `pool/main/f/finder/` on the `gh-pages` branch, delete the unwanted `.deb`, then re-run the workflow with `workflow_dispatch` (no new tag needed) — the script will regenerate `Packages` without the deleted version.
