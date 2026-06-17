#!/usr/bin/env bash
# Fortune Wheel — asset prep.
# Turns the raw generated art (repo-root fortune-wheel-assets/ + sharde-ui-kit/) into
# game-ready textures under games/fortune-wheel/art/. The assets came back with real
# alpha, so we just trim + downscale (no white-keying). The wheel face is drawn in code
# inside wheel_rim.png, so the rim ships with a blank dark center.
#
# Idempotent: safe to re-run. Requires ImageMagick 7 (`magick`).
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
WHEEL="$REPO/fortune-wheel-assets"
UIKIT="$REPO/sharde-ui-kit"
OUT="$REPO/games/fortune-wheel/art"

command -v magick >/dev/null || { echo "ImageMagick (magick) not found"; exit 1; }
[ -d "$WHEEL" ] || { echo "missing $WHEEL"; exit 1; }
[ -d "$UIKIT" ] || { echo "missing $UIKIT"; exit 1; }

mkdir -p "$OUT"/{bg,ui}

ui() { echo "$UIKIT/shared-ui-kit-buttons copy $1@2x.png"; }
# Plain "copy" (no number) is the autospin/refresh button.
ui_base() { echo "$UIKIT/shared-ui-kit-buttons copy@2x.png"; }

# --- background (full scene) -> 1080 wide JPG -------------------------------------
magick "$WHEEL/bg_wheel@2x.png" -background black -alpha remove -alpha off \
       -resize 1080x -strip -quality 88 "$OUT/bg/bg_wheel.jpg"
echo "  bg      bg_wheel.jpg"

# --- wheel pieces (keep alpha; trim transparent border) --------------------------
magick "$WHEEL/wheel_rim@2x.png" -trim +repage -resize 760x760 -strip "$OUT/ui/wheel_rim.png"
magick "$WHEEL/pointer@2x.png"   -trim +repage -resize 120x   -strip "$OUT/ui/pointer.png"
magick "$WHEEL/hub@2x.png"       -trim +repage -resize 200x200 -strip "$OUT/ui/hub.png"
echo "  ui      wheel_rim / pointer / hub"

# --- shared UI kit -> named buttons (trim + bound size) --------------------------
magick "$(ui 10)"   -trim +repage -resize 256x256 -strip "$OUT/ui/btn_action.png"   # big spin
magick "$(ui 3)"    -trim +repage -resize 520x     -strip "$OUT/ui/toggle_pill.png" # risk selector
magick "$(ui 2)"    -trim +repage -resize 520x     -strip "$OUT/ui/readout_pill.png"
magick "$(ui 4)"    -trim +repage -resize 128x128 -strip "$OUT/ui/btn_menu.png"
magick "$(ui 5)"    -trim +repage -resize 128x128 -strip "$OUT/ui/btn_info.png"
magick "$(ui 7)"    -trim +repage -resize 128x128 -strip "$OUT/ui/btn_sound.png"
magick "$(ui 8)"    -trim +repage -resize 176x176 -strip "$OUT/ui/btn_minus.png"
magick "$(ui 9)"    -trim +repage -resize 176x176 -strip "$OUT/ui/btn_plus.png"
magick "$(ui_base)" -trim +repage -resize 176x176 -strip "$OUT/ui/btn_autospin.png"
echo "  ui      9 shared buttons"

echo "Done. Output: $OUT"
