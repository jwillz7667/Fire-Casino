#!/usr/bin/env bash
# Dragon's Hoard Bonanza — asset prep.
# Turns the raw generated art in Dragon-icons/ into game-ready textures under
# games/dragon-hoard/art/. The critical fix: the 27MB portrait bg is downscaled
# BEFORE Godot import so it never ships as ~70MB of RGBA that would crash low-end
# WebGL2 VRAM. Symbols are normalized to a uniform 512x512 canvas with equal padding
# so the renderer's single scale constant (CELL*0.92/512) holds, and UPPERCASE
# filenames match the server SymbolId contract (engines/dragon/symbols.ts).
#
# Source filenames are the raw "symbols-set copy N.png" sheets the artist delivered;
# the N -> SymbolId / UI map below is the single place that mapping lives.
#
# Idempotent: safe to re-run. Requires ImageMagick 7 (`magick`).
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
SRC="$REPO/Dragon-icons"
OUT="$REPO/games/dragon-hoard/art"

command -v magick >/dev/null || { echo "ImageMagick (magick) not found"; exit 1; }
[ -d "$SRC" ] || { echo "source dir missing: $SRC"; exit 1; }

src() { echo "$SRC/symbols-set copy $1.png"; }

mkdir -p "$OUT"/{symbols,symbols_blur,ui,bg,fx}

# --- (1) Symbols: SymbolId -> source sheet number. Uppercase output = server contract.
# GOLD/RED/BLUE_DRAGON = framed dragon portraits; gems = hex gems; A/K/Q/J = card
# royals; WILD = the dragon crest; COINS = the gold-hoard scatter.
SYMBOLS="
GOLD_DRAGON 33
RED_DRAGON 13
BLUE_DRAGON 14
RED_GEM 23
GREEN_GEM 22
BLUE_GEM 21
A 20
K 19
Q 12
J 15
WILD 11
COINS 16
"
echo "$SYMBOLS" | while read -r ID NUM; do
  [ -z "${ID:-}" ] && continue
  in="$(src "$NUM")"
  [ -f "$in" ] || { echo "  MISSING $in"; exit 1; }
  # trim transparent border -> center on a uniform 640 canvas -> 512x512
  magick "$in" -trim +repage -background none -gravity center \
         -extent 640x640 -resize 512x512 -strip "$OUT/symbols/$ID.png"
  # vertical motion-blur copy for the spin loop
  magick "$OUT/symbols/$ID.png" -motion-blur 0x22+90 -strip "$OUT/symbols_blur/$ID.png"
  echo "  symbol  $ID.png (+blur)"
done

# --- (2) Background: portrait 3108x5540 (~9:16) -> 1080x1925 JPG --------------------
magick "$SRC/bg.png" -resize 1080x -strip -quality 86 "$OUT/bg/bg_base.jpg"
echo "  bg      bg_base.jpg"
# free-spins variant: warmer + gilded, to crossfade in when the feature starts
magick "$SRC/bg.png" -resize 1080x -modulate 105,130,80 -fill '#3a2406' -colorize 16% \
       -strip -quality 86 "$OUT/bg/bg_freespins.jpg"
echo "  bg      bg_freespins.jpg"

# --- (3) Buttons & HUD art: native-aspect, bounded resolution ----------------------
magick "$(src 5)"  -resize 256x256 -strip "$OUT/ui/btn_spin.png"      # big circular spin
magick "$(src 37)" -resize 200x166 -strip "$OUT/ui/btn_autospin.png"  # rounded ▶
magick "$(src 38)" -resize 220x150 -strip "$OUT/ui/btn_bet_plus.png"
magick "$(src 39)" -resize 220x150 -strip "$OUT/ui/btn_bet_minus.png"
magick "$(src 31)" -resize 128x128 -strip "$OUT/ui/btn_info.png"
magick "$(src 7)"  -resize 128x128 -strip "$OUT/ui/btn_sound.png"
magick "$(src 6)"  -resize 128x128 -strip "$OUT/ui/btn_menu.png"
magick "$(src 10)" -resize 900x   -strip "$OUT/ui/title_logo.png"     # "Dragon's Hoard Bonanza"
magick "$(src 9)"  -resize 480x   -strip "$OUT/ui/badge_lines.png"    # "25 LINES"
magick "$(src 8)"  -resize 520x   -strip "$OUT/ui/badge_freespins.png" # "FREE SPINS x/y"
magick "$(src 34)" -resize 360x   -strip "$OUT/ui/pill.png"           # readout pill bg
echo "  ui      buttons + title + badges"

echo "Done. Output: $OUT"
