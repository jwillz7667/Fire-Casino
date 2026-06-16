#!/usr/bin/env bash
# Royal Ascendant — export the Godot web build, inject the bridge, and stage it into
# the arcade's public dir for SAME-ORIGIN hosting on Vercel (no R2 needed). The
# `nothreads` preset means no COOP/COEP headers are required, so a plain static host
# serves it. Re-run after any client change; commit the staged dir.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"   # games/royal-ascendant
REPO="$(cd "$HERE/../.." && pwd)"
GODOT="${GODOT:-/Applications/Godot.app/Contents/MacOS/Godot}"
DEST="$REPO/apps/arcade/public/royal-ascendant/v3"

"$GODOT" --headless --path "$HERE" --import
mkdir -p "$HERE/build"
"$GODOT" --headless --path "$HERE" --export-release "Web" "$HERE/build/index.html"
cp "$HERE/web/royal-bridge.js" "$HERE/build/royal-bridge.js"

rm -rf "$DEST"; mkdir -p "$DEST"
cp "$HERE"/build/* "$DEST"/
rm -f "$DEST"/*.import   # Godot import metadata — not needed by the web host
echo "staged -> $DEST"
du -sh "$DEST"
