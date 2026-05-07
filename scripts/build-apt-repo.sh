#!/usr/bin/env bash
#
# Build or update a Debian APT repository from one or more .deb files.
# The output directory is ready to be served as static files (e.g. via GitHub Pages).
#
# Usage:
#   GPG_KEY_ID=<key-id> ./scripts/build-apt-repo.sh <repo-dir> <deb-file> [more-debs...]
#
# Required env:
#   GPG_KEY_ID         long key ID or fingerprint of the signing key
#   GPG_PASSPHRASE     (optional) passphrase if the key has one
#
# Required tools: dpkg-scanpackages, gpg, gzip, sha256sum, md5sum
#
# Idempotent: runs against an existing repo merge-add new .debs and regenerate metadata.

set -euo pipefail

REPO_DIR="${1:-}"
shift || true
DEBS=("$@")

if [[ -z "$REPO_DIR" || ${#DEBS[@]} -eq 0 ]]; then
  echo "Usage: $0 <repo-dir> <deb-file> [more-debs...]" >&2
  exit 1
fi
if [[ -z "${GPG_KEY_ID:-}" ]]; then
  echo "Error: GPG_KEY_ID environment variable is required" >&2
  exit 1
fi

SUITE="stable"
COMPONENT="main"
ARCH="amd64"
PKG="pwfinder"

POOL_DIR="$REPO_DIR/pool/$COMPONENT/${PKG:0:1}/$PKG"
DISTS_DIR="$REPO_DIR/dists/$SUITE"
PKG_DIR="$DISTS_DIR/$COMPONENT/binary-$ARCH"

mkdir -p "$POOL_DIR" "$PKG_DIR"

echo "==> Adding .debs to pool"
for deb in "${DEBS[@]}"; do
  if [[ ! -f "$deb" ]]; then
    echo "  Warning: $deb not found, skipping" >&2
    continue
  fi
  cp -v "$deb" "$POOL_DIR/"
done

echo "==> Generating Packages"
(
  cd "$REPO_DIR"
  dpkg-scanpackages --multiversion pool/ > "dists/$SUITE/$COMPONENT/binary-$ARCH/Packages"
  gzip -kf9 "dists/$SUITE/$COMPONENT/binary-$ARCH/Packages"
)

echo "==> Writing Release"
RELEASE_FILE="$DISTS_DIR/Release"

# Remove old signatures so they don't get hashed into the new Release
rm -f "$DISTS_DIR/Release" "$DISTS_DIR/Release.gpg" "$DISTS_DIR/InRelease"

{
  cat <<EOF
Origin: PWFinder
Label: PWFinder
Suite: $SUITE
Codename: $SUITE
Version: 1.0
Architectures: $ARCH
Components: $COMPONENT
Description: PWFinder file explorer apt repository
Date: $(date -Ru)
EOF

  echo "MD5Sum:"
  ( cd "$DISTS_DIR" && find . -type f ! -name 'Release*' ! -name 'InRelease' \
      | sed 's|^\./||' | sort \
      | while read -r f; do
          size=$(stat -c%s "$f")
          hash=$(md5sum "$f" | awk '{print $1}')
          printf " %s %16d %s\n" "$hash" "$size" "$f"
        done )

  echo "SHA256:"
  ( cd "$DISTS_DIR" && find . -type f ! -name 'Release*' ! -name 'InRelease' \
      | sed 's|^\./||' | sort \
      | while read -r f; do
          size=$(stat -c%s "$f")
          hash=$(sha256sum "$f" | awk '{print $1}')
          printf " %s %16d %s\n" "$hash" "$size" "$f"
        done )
} > "$RELEASE_FILE"

echo "==> Signing Release"
GPG_OPTS=(--default-key "$GPG_KEY_ID" --batch --yes --pinentry-mode loopback)
if [[ -n "${GPG_PASSPHRASE:-}" ]]; then
  GPG_OPTS+=(--passphrase "$GPG_PASSPHRASE")
fi

gpg "${GPG_OPTS[@]}" --detach-sign --armor \
  --output "$DISTS_DIR/Release.gpg" "$RELEASE_FILE"

gpg "${GPG_OPTS[@]}" --clearsign \
  --output "$DISTS_DIR/InRelease" "$RELEASE_FILE"

echo "==> Exporting public key"
gpg --armor --export "$GPG_KEY_ID" > "$REPO_DIR/pubkey.gpg"

# Helpful index page so visiting the GitHub Pages URL is not a 404
cat > "$REPO_DIR/index.html" <<'EOF'
<!doctype html>
<meta charset="utf-8">
<title>PWFinder APT repo</title>
<style>body{font-family:system-ui,sans-serif;max-width:680px;margin:48px auto;padding:0 16px;color:#2c3138;line-height:1.6}code{background:#f1f4f7;padding:2px 6px;border-radius:4px;font-family:ui-monospace,monospace}pre{background:#f1f4f7;padding:12px 16px;border-radius:6px;overflow:auto}h1{margin-bottom:4px}h2{margin-top:32px}</style>
<h1>PWFinder APT repository</h1>
<p>Add this repo to your Ubuntu/Debian system:</p>
<pre><code>curl -fsSL https://__PAGE_URL__/pubkey.gpg | sudo gpg --dearmor -o /usr/share/keyrings/pwfinder.gpg
echo "deb [signed-by=/usr/share/keyrings/pwfinder.gpg] https://__PAGE_URL__ stable main" | sudo tee /etc/apt/sources.list.d/pwfinder.list
sudo apt update
sudo apt install pwfinder</code></pre>
<p>See the <a href="https://github.com/__GH_REPO__">GitHub repo</a> for source.</p>
EOF

echo
echo "Repo built at: $REPO_DIR"
echo "  pool/:  $(find "$REPO_DIR/pool" -type f -name '*.deb' | wc -l) .deb files"
echo "  size:   $(du -sh "$REPO_DIR" | awk '{print $1}')"
