#!/usr/bin/env bash
# Legend of the Flaming Kirin — export the Godot web build, inject the bridge, and upload it
# to public Cloudflare R2 (bucket `goldwave`, prefix flaming-kirin/<VER>). The build AND the
# lobby thumbnail are served from R2 (NOT bundled into the Vercel deploy). The `nothreads`
# preset needs no COOP/COEP headers, so the plain r2.dev host serves it.
#
# Re-run after any client change and BUMP VER on a rebuild (R2 objects are immutable-cached),
# then point R2_GAME_URL in apps/arcade/src/components/game/FlamingKirinGodot.tsx at the new
# prefix.
#
# Requires: a 4.6.x Godot (override GODOT=...), awscli, and R2 creds in <repo>/.env.production
# (R2_ACCOUNT_ID / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY / R2_BUCKET_ASSETS). Example:
#   GODOT=/Applications/Godot.app/Contents/MacOS/Godot VER=v1 bash web/build.sh
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"   # games/flaming-kirin
REPO="$(cd "$HERE/../.." && pwd)"
GODOT="${GODOT:-/Applications/Godot.app/Contents/MacOS/Godot}"
VER="${VER:-v1}"

"$GODOT" --headless --path "$HERE" --import
mkdir -p "$HERE/build"
"$GODOT" --headless --path "$HERE" --export-release "Web" "$HERE/build/index.html"
cp "$HERE/web/flaming-kirin-bridge.js" "$HERE/build/flaming-kirin-bridge.js"
rm -f "$HERE"/build/*.import   # Godot import metadata — not needed by the web host

# --- upload to public R2 -----------------------------------------------------------
set -a; eval "$(grep -E '^R2_(ACCOUNT_ID|ACCESS_KEY_ID|SECRET_ACCESS_KEY|BUCKET_ASSETS)=' "$REPO/.env.production")"; set +a
export AWS_ACCESS_KEY_ID="$R2_ACCESS_KEY_ID" AWS_SECRET_ACCESS_KEY="$R2_SECRET_ACCESS_KEY" AWS_DEFAULT_REGION=auto
aws configure set default.s3.multipart_threshold 512MB
ENDPOINT="https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com"
DEST="s3://${R2_BUCKET_ASSETS}/flaming-kirin/${VER}"
ct() { case "$1" in
  *.wasm) echo application/wasm;; *.js) echo text/javascript;; *.html) echo text/html;;
  *.pck) echo application/octet-stream;; *.png) echo image/png;; *.jpg) echo image/jpeg;;
  *) echo application/octet-stream;; esac; }
for f in "$HERE"/build/*; do
  n="$(basename "$f")"
  aws s3 cp "$f" "$DEST/$n" --endpoint-url "$ENDPOINT" \
    --content-type "$(ct "$n")" --cache-control "public,max-age=31536000,immutable" --no-progress
done

# --- lobby thumbnail (stable, un-versioned path the catalog row points at) ----------
if [ -f "$HERE/thumb.png" ]; then
  aws s3 cp "$HERE/thumb.png" "s3://${R2_BUCKET_ASSETS}/flaming-kirin/thumb.png" \
    --endpoint-url "$ENDPOINT" --content-type image/png \
    --cache-control "public,max-age=86400" --no-progress
  echo "thumbnail -> s3://${R2_BUCKET_ASSETS}/flaming-kirin/thumb.png"
fi

echo "uploaded -> $DEST"
echo "set R2_GAME_URL in FlamingKirinGodot.tsx to https://pub-a2458a29274f4f5ba61f429adf2fcf8f.r2.dev/flaming-kirin/${VER}/index.html"
