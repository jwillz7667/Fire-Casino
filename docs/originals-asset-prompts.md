# Goldwave "Originals" — Asset Generation Prompts

Asset prompts for the four new Godot-rendered games, tuned for **Google Nano Banana Pro**.

Build order: **Fortune Wheel → Plinko → Vault Run (Mines) → Ascend (Crash)**. Renderer:
Godot/WASM (same pipeline as the slots) hosted on Cloudflare R2.

## How to use
1. Paste the `STYLE` block **+** the asset's line as one prompt.
2. Generate a whole set **in one chat session** so the look stays cohesive (Nano Banana
   keeps style well — "same style as the previous image" works great).
3. **Every sprite goes on a plain solid WHITE background (#FFFFFF), not transparent** — I
   key the white out to transparency cleanly on import. (Backgrounds = full scenes, no white.)
4. Generate at ~2× and let me downscale; sizes below are targets, not hard limits.
5. Deliver: drop the files in the repo and tell me which game — I map them to the Godot `art/` dirs.

---

## STYLE (prepend to EVERY prompt)
```
STYLE: premium mobile casino game art for "Goldwave Casino" — deep obsidian & midnight-navy
base, molten-gold and electric-teal neon accents, glossy semi-3D rendered look, soft rim
lighting, ultra-clean, high detail, one cohesive set. No text, no watermark, no baked-in
drop shadow. Centered subject.
```

---

## Shared UI kit — generate ONCE, used by all 4 games

Generate **all of these in ONE image**, arranged as a neat grid on a **plain solid white
background** — sizes don't matter, just keep each icon crisp and well separated:

```
- a large round glossy gold casino ACTION button, blank face, thick concentric gold ring,
  subtle inner glow, slight bevel
- a rounded-square glossy gold "+" stepper button (plus shape embossed in the metal)
- a rounded-square glossy gold "-" stepper button (minus embossed)
- a small round gold icon button with a SPEAKER glyph embossed
- a small round gold icon button with an "i" (info) glyph embossed
- a small round gold icon button with a 3-line HAMBURGER menu glyph embossed
- a horizontal segmented selector PILL, three equal slots, dark glass body with a glowing
  gold rim, left slot lit
- a wide rounded "glass" display PILL for numbers, dark translucent body, thin gold rim, soft
  inner glow, EMPTY face (no text)
- a single glossy gold COIN token, subtle wave/"G" emboss on the face, metallic highlights

All on a plain white background, evenly spaced, no text labels.
```

---

## 1) Fortune Wheel

```
bg_wheel.png (9:16, 1080x1920)  — opulent dark casino backdrop: deep navy-to-black velvet with
  a faint warm radial glow in the center where a wheel will sit, subtle gold bokeh and light
  rays, atmospheric, full-bleed vertical, keep the center area clean and uncluttered.

wheel_rim.png (1:1, 1280x1280)  — an ornate circular fortune-wheel FRAME/RIM only: thick gold
  filigree ring with small inset gems and stud bolts, surrounding an EMPTY dark glossy disc
  (NO wedges, NO segments, NO numbers, NO text — just the rim and a plain dark center). Top-down,
  perfectly circular, on a solid white background, PNG.
  [I draw the 30 colored wedges + multipliers in code inside this rim, so leave it blank.]

pointer.png (3:5, 192x320)  — a sleek gold wheel pointer/ticker that hangs from the top edge,
  arrow tip facing down, glossy metal with a teal gem. Solid white background, PNG.

hub.png (1:1, 320x320)  — a circular gold center medallion/cap for the wheel hub, embossed wave
  "G" emblem, polished, slight dome. Solid white background, PNG.
```

---

## 2) Plinko

```
bg_plinko.png (9:16, 1080x1920)  — a vertical neon "drop chamber": dark obsidian side walls with
  faint gold circuitry etching, soft teal volumetric glow rising from the bottom, empty clean
  center column for the pegboard, atmospheric, full-bleed vertical.

peg.png (1:1, 96x96)  — a single small glowing gold peg/pin, smooth metallic sphere with a soft
  warm halo. Solid white background, PNG.

ball.png (1:1, 128x128)  — a glossy molten-gold coin-orb the player drops, metallic with a subtle
  inner fire glow and bright specular highlight. Solid white background, PNG.

bucket_green.png (8:5, 320x200)  — a single trapezoid landing slot (wider at top), emerald-neon
  glowing rim on a dark glass body, EMPTY face. LOW multiplier. Solid white background, PNG.

bucket_gold.png (8:5, 320x200)  — same trapezoid slot shape, molten-gold glowing rim. MID
  multiplier. Solid white background, PNG.

bucket_red.png (8:5, 320x200)  — same trapezoid slot shape, crimson-neon glowing rim. HIGH
  multiplier. Solid white background, PNG.

win_burst.png (1:1, 768x768)  — a radial burst of gold coins and bright sparks exploding outward
  from center, win celebration FX. Solid white background, PNG.
```

---

## 3) Vault Run (Mines)

```
bg_vault.png (9:16, 1080x1920)  — a dark treasury/vault wall: faint gold safe-door rings and
  stacked gold bullion in deep shadow, moody spotlight, clean empty center for a tile grid,
  full-bleed vertical.

tile_closed.png (1:1, 256x256)  — a glossy gold-bordered "obsidian glass" square tile, unrevealed,
  subtle sheen and rounded corners. Solid white background, PNG.

tile_gem.png (1:1, 256x256)  — the same gold-bordered tile, opened to reveal a brilliant faceted
  teal/violet gemstone glowing in the center, sparkling (the SAFE reveal). Solid white background, PNG.

tile_bomb.png (1:1, 256x256)  — the same gold-bordered tile, opened to reveal a glowing dark
  bomb / cracked gold mine with a lit orange fuse (the LOSE reveal). Solid white background, PNG.

gem_pop.png (1:1, 512x512)  — a bright sparkle/star burst FX for revealing a gem. Solid white
  background, PNG.

boom.png (1:1, 640x640)  — a small fiery orange explosion burst with smoke and debris, for hitting
  a mine. Solid white background, PNG.
```

---

## 4) Ascend (Crash)

```
bg_ascend.png (9:20, 1080x2400)  — a tall vertical gradient scene the rocket climbs through:
  glowing city-lights horizon at the bottom, deep midnight sky in the middle, star-filled space
  at the top, with a few soft clouds; designed to scroll vertically (parallax-friendly), full-bleed.

rocket.png (1:1, 640x640)  — a sleek golden rocket/jet angled pointing UP-and-to-the-RIGHT,
  electric-teal cockpit glow, polished metal, clean dynamic silhouette. Solid white background, PNG.

thrust.png (1:1, 320x320)  — a neon flame/exhaust plume, molten-gold core fading to electric-teal
  edges, rendered SEPARATELY so it can flicker behind the rocket. Solid white background, PNG.

explosion.png (1:1, 1024x1024)  — a large fiery gold-and-orange explosion burst with smoke and
  debris (the "bust" moment). Solid white background, PNG.

trail_glow.png (4:1, 256x64)  — a soft glowing horizontal gold streak segment, tileable, used to
  draw the rising trajectory line. Solid white background, PNG.

star_layer.png (1:1, 1080x1080)  — a sparse field of small twinkling stars and faint gold particles.
  Solid white background, PNG.
```

---

## Title logos — one per game (`title_logo.png`)

Image generators render short titles well, but **always check the spelling** of the output and
regenerate if a letter is mangled. Each is a wide horizontal lockup, ~`8:3` (≈1600x600), on a
**solid white background** (I key it out). Keep the exact text in quotes.

```
LOGO STYLE: a premium casino game TITLE LOGO — bold 3D glossy gold metallic lettering with
beveled edges, molten-gold highlights and a subtle electric-teal rim glow, a thin dark outline
for legibility, ornate but very readable, centered horizontal lockup, solid white background,
correct spelling, no extra text or tagline.
```

```
1) Fortune Wheel  — [LOGO STYLE] the words "FORTUNE WHEEL" in an elegant Vegas-gold display
   serif, a faint gold sunburst / wheel-spoke flourish radiating behind the letters, sparkle accents.

2) Plinko         — [LOGO STYLE] the single word "PLINKO" in bold, rounded, playful arcade
   letters, a little row of glowing gold pegs/dots arcing above or through the word, fun neon energy.

3) Vault Run      — [LOGO STYLE] the words "VAULT RUN" in heavy industrial riveted-metal gold
   letters (slight stencil), a hint of a vault dial and a faint danger glow, heist vibe.

4) Ascend         — [LOGO STYLE] the single word "ASCEND" in dynamic italic letters slanting
   UP and to the RIGHT with a gold-to-teal speed/neon motion trail streaking off the last letter.
```

If you'd rather brand them all "GOLDWAVE <NAME>", just add a small `"GOLDWAVE"` word above the
main title in each prompt — but the short hero word usually reads better in-game.

---

## Notes for the build (FYI — no action needed from you)
- **White backgrounds, not transparent:** every sprite ships on solid white (#FFFFFF); I key
  the white to transparency + trim on import. (The `bg_*` files are full scenes, no white.)
- **Blank faces on purpose:** the wheel wedges + multiplier numbers, plinko bucket numbers, mine
  grid, and the crash multiplier/curve are drawn in Godot code over these assets — so the
  rim/buckets/pills ship with empty faces.
- **Sizes are targets**, not hard requirements — bigger is fine, I downscale on import.
- Hand me a set per game and I build that game's Godot client → R2 → live (same as Dragon).
```

> Heads-up on white-keying: a few of these (the **thrust flame**, **explosion**, **gem/coin
> bursts**, **star layer**) have soft glow edges that fade toward white — keying pure white can
> nibble those edges. If one comes out with a halo, regenerate that single FX on a **flat
> mid-grey or black** background instead and tell me; everything else is fine on white.
