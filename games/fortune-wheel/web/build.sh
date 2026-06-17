#!/usr/bin/env bash
# Fortune Wheel — export the Godot web build, inject the bridge, and upload to public
# Cloudflare R2 (bucket `goldwave`, prefix fortune-wheel/<VER>). Served from R2 like the
# other games. The `nothreads` preset needs no COOP/COEP headers.
#
# Re-run after any client change and BUMP VER on a rebuild (R2 objects are immutable-
# cached), then point R2_GAME_URL in apps/arcade/src/components/game/WheelGodot.tsx at it.
#
# Requires: a 4.6.x Godot (override GODOT=...), awscli, R2 creds in <repo>/.env.production.
#   GODOT=/tmp/godot463/Godot.app/Contents/MacOS/Godot VER=v1 bash web/build.sh
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"   # games/fortune-wheel
REPO="$(cd "$HERE/../.." && pwd)"
GODOT="${GODOT:-/Applications/Godot.app/Contents/MacOS/Godot}"
VER="${VER:-v1}"

"$GODOT" --headless --path "$HERE" --import
mkdir -p "$HERE/build"
"$GODOT" --headless --path "$HERE" --export-release "Web" "$HERE/build/index.html"
cp "$HERE/web/wheel-bridge.js" "$HERE/build/wheel-bridge.js"
rm -f "$HERE"/build/*.import

set -a; eval "$(grep -E '^R2_(ACCOUNT_ID|ACCESS_KEY_ID|SECRET_ACCESS_KEY|BUCKET_ASSETS)=' "$REPO/.env.production")"; set +a
export AWS_ACCESS_KEY_ID="$R2_ACCESS_KEY_ID" AWS_SECRET_ACCESS_KEY="$R2_SECRET_ACCESS_KEY" AWS_DEFAULT_REGION=auto
aws configure set default.s3.multipart_threshold 128MB
ENDPOINT="https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com"
DEST="s3://${R2_BUCKET_ASSETS}/fortune-wheel/${VER}"
ct() { case "$1" in
  *.wasm) echo application/wasm;; *.js) echo text/javascript;; *.html) echo text/html;;
  *.pck) echo application/octet-stream;; *.png) echo image/png;; *) echo application/octet-stream;; esac; }
for f in "$HERE"/build/*; do
  n="$(basename "$f")"
  aws s3 cp "$f" "$DEST/$n" --endpoint-url "$ENDPOINT" \
    --content-type "$(ct "$n")" --cache-control "public,max-age=31536000,immutable" --no-progress
done
echo "uploaded -> $DEST"
echo "set R2_GAME_URL in WheelGodot.tsx to https://pub-a2458a29274f4f5ba61f429adf2fcf8f.r2.dev/fortune-wheel/${VER}/index.html"
