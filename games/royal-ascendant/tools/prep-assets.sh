#!/usr/bin/env bash
# Royal Ascendant — asset prep.
# Turns the raw generated art in slot-icons/ into game-ready textures under
# games/royal-ascendant/art/. The two critical fixes: the 34MB landscape bg and
# the 18MB reel frame are downscaled BEFORE Godot import so they never ship as
# ~90MB of RGBA that would crash low-end WebGL2 VRAM. Symbols are normalized to a
# uniform 512x512 canvas with equal padding so the renderer's single scale
# constant (CELL*0.92/512) ports verbatim and uppercase filenames match the
# server SymbolId contract.
#
# Idempotent: safe to re-run. Requires ImageMagick 7 (`magick`).
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
SRC="$REPO/slot-icons"
OUT="$REPO/games/royal-ascendant/art"

command -v magick >/dev/null || { echo "ImageMagick (magick) not found"; exit 1; }
[ -d "$SRC" ] || { echo "source dir missing: $SRC"; exit 1; }

mkdir -p "$OUT"/{symbols,symbols_blur,ui,bg,fx}

# --- (1) Symbols: SymbolId -> source. Uppercase output = server contract. ------
# QUEEN = portrait lady (sym_queen); Q = card queen w/ rose (sym_q). Distinct.
SYMBOLS="
QUEEN sym_queen
CASTLE sym_castle
SHIELD sym_shield
A sym_a
K sym_k
Q sym_q
J sym_j
TEN sym_ten
JOKER sym_joker
CHEST sym_chest
"
echo "$SYMBOLS" | while read -r ID SRCNAME; do
  [ -z "${ID:-}" ] && continue
  in="$SRC/$SRCNAME.png"
  [ -f "$in" ] || { echo "  MISSING $in"; exit 1; }
  # trim transparent border -> center on a uniform 680 canvas -> 512x512
  magick "$in" -trim +repage -background none -gravity center \
         -extent 680x680 -resize 512x512 -strip "$OUT/symbols/$ID.png"
  # vertical motion-blur copy for the spin loop
  magick "$OUT/symbols/$ID.png" -motion-blur 0x22+90 -strip "$OUT/symbols_blur/$ID.png"
  echo "  symbol  $ID.png (+blur)"
done

# --- (2) Background: 5870x3815 (3:2) -> crop to 16:9 -> 1920x1080 JPG ----------
magick "$SRC/bg_base.png" -gravity center -crop 5870x3301+0+0 +repage \
       -resize 1920x1080^ -gravity center -extent 1920x1080 \
       -strip -quality 86 "$OUT/bg/bg_base.jpg"
echo "  bg      bg_base.jpg"
# free-spins variant: cooler + slightly darkened
magick "$SRC/bg_base.png" -gravity center -crop 5870x3301+0+0 +repage \
       -modulate 100,120,150 -fill '#101830' -colorize 18% \
       -resize 1920x1080^ -gravity center -extent 1920x1080 \
       -strip -quality 86 "$OUT/bg/bg_freespins.jpg"
echo "  bg      bg_freespins.jpg"

# --- (3) Reel frame: 4509x2510 -> 1536x855, keep alpha (no slicing) -----------
magick "$SRC/reel_frame.png" -resize 1536x -strip "$OUT/ui/reel_frame.png"
echo "  ui      reel_frame.png"

# --- (4) Buttons: native-aspect fixed sizes -----------------------------------
magick "$SRC/btn_spin.png" -resize 256x256 -strip "$OUT/ui/btn_spin.png"
for b in info sound; do
  magick "$SRC/btn_$b.png" -resize 128x128 -strip "$OUT/ui/btn_$b.png"
done
for b in bet_minus bet_plus maxbet autospin lines info_bar; do
  magick "$SRC/btn_$b.png" -resize 256x104 -strip "$OUT/ui/btn_$b.png"
done
echo "  ui      9 buttons"

echo "Done. Output: $OUT"
