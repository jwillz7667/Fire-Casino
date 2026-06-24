# Leviathan's Deep — asset → symbol mapping (delivered)

Assets are cut out (transparent alpha) and live in `assets/Leviathan's-Deep/`. Build spec:

| Engine symbol id | File | Tier |
|---|---|---|
| `LEVIATHAN` | `snake.png` | high |
| `KRAKEN` | `kraken.png` | high |
| `SIREN` | `princess.png` | high |
| `TRIDENT` | `trident.png` | high |
| `CHEST` | `treasure.png` | high |
| `PEARL` | `pearl.png` | low |
| `AQUA` | `diamond.png` | low |
| `SAPPHIRE` | `blue_ruby.png` | low |
| `AMETHYST` | `purple_ruby.png` | low |
| `EMERALD` | `green_ruby.png` | low |
| `WILD` | `wild.png` | special |
| `SCATTER` | `scatter.png` | special (→ free spins) |
| `BONUS` | `bonus.png` | special (→ bonus) |
| `MULT_ORB` | `orb.png` | free-spins multiplier badge |

Scene art: `bg.png` (3072×5504 portrait scene), `frame.png` (2991×2740 reel frame, alpha),
backplate = `Generated Image June 23, 2026 - 5_09PM.png` (2476×1821 — rename to `backplate.png` on import).
UI: `spin.png`, `turbo.png`, readout pills `balance.png`/`bet.png`/`win.png`, `title.png`.
Win word-art: `big_win.png`, `mega_win.png`, `epic_win.png`, `free_pins.png` (FREE SPINS),
`kraken_awakens.png`. Spare: `chest.png` (second chest — unused unless a 6th high symbol is added).

**Gaps (non-blocking, will code-draw in Godot):** bet +/−, autoplay, max-bet, settings, sound,
info, menu buttons. No jackpot plaques — the flagship uses tumbling reels + rising-tide
multiplier free spins + Kraken-Awakens bonus instead of a 4-tier jackpot.

---

# Leviathan's Deep — Gemini image-gen prompts

Flagship slot (working title **"Leviathan's Deep"**): 6×5 / 4096-ways, tumbling reels,
rising-tide multiplier free spins, "Kraken Awakens" anticipation. Cool teal/cyan/gold palette
to contrast the warm Phoenix/Inferno/Kirin library.

**How to run:** each block below is one generation → one 4K image. All on a **solid white
(#FFFFFF) background** for easy cut/background removal. After removal, slice each grid into
individual transparent PNGs. Model: Nano Banana Pro / `gemini-3-pro-image`.

> ⚠️ White-on-white risk: the white pearl and bright-gold elements can blend into the white
> background. Every prompt instructs a **thin dark-teal rim/outline on pale elements** so the
> keyer has an edge to grab.

---

## 1 — SYMBOLS manifest

```
Generate a SINGLE 4K image (3840x2160 or larger), a sprite sheet of 14 premium mobile slot-machine symbols for an undersea treasure slot called "Leviathan's Deep". Pragmatic-Play / top-tier studio quality: glossy 2.5D rendered look, rich painterly detail, strong top key light plus cyan rim light, ornate gold filigree borders, vibrant saturated color, front-facing orthographic view, no perspective distortion.

Arrange in a neat 4-column grid, GENEROUS even spacing, each symbol fully isolated and centered, uniform square scale, NO symbol touching another. Pure solid white (#FFFFFF) background, flat and even, NO background gradient, NO drop shadows bleeding between items. CRITICAL for clean background removal: give every light/white/pale symbol a thin dark teal outline and a subtle rim so it separates cleanly from the white background. Do not add any text labels except words engraved ON the symbols as described.

The 14 symbols:
1. Leviathan — coiled ancient sea-serpent, glowing amber eyes, top symbol
2. Kraken — menacing giant octopus, suckered tentacles
3. Siren Queen — regal mermaid sorceress with a pearl crown
4. Golden Trident — ornate Poseidon trident, jeweled
5. Treasure Chest — overflowing with gold coins and pearls
6. White Pearl — large iridescent pearl (give it a dark rim)
7. Aqua Diamond — faceted teal gemstone
8. Sapphire — faceted deep-blue gemstone
9. Amethyst — faceted purple gemstone
10. Emerald — faceted green gemstone
11. WILD — glowing golden medallion wrapped in coral, the word "WILD" engraved in gold
12. SCATTER — radiant golden conch shell, the word "SCATTER" engraved
13. BONUS — kraken-eye amulet over a treasure map, the word "BONUS" engraved
14. MULTIPLIER ORB — glowing bioluminescent pearl orb (blank face, for a number to be added later)
```

---

## 2 — UI / BUTTONS manifest

```
Generate a SINGLE 4K image (3840x2160 or larger), a UI sprite sheet for an undersea treasure slot "Leviathan's Deep". Premium top-studio mobile-casino UI: ornate gold-and-teal, glossy 2.5D, underwater-temple motifs (coral, tridents, whirlpools), strong rim light.

Arrange in a neat labeled grid, GENEROUS even spacing, each element fully isolated, NO element touching another. Pure solid white (#FFFFFF) flat background, NO gradient, NO bleeding shadows. CRITICAL: outline every pale/gold element with a thin dark teal edge so it cuts cleanly off the white background.

Include:
- Large circular SPIN button (gold ring, trident/whirlpool center), plus a pressed-state variant
- Turbo / fast-spin button
- Autoplay button, Auto-bet button, Max-bet button
- Bet increase (+) button and bet decrease (-) button (round)
- Settings (gear), Sound on, Sound off, Info (i), and Menu (hamburger) buttons
- Four ornate jackpot plaques labeled GRAND, MAJOR, MINOR, MINI
- Three readout pills/frames for BALANCE, BET, and WIN (blank centers for numbers)
All buttons same visual family, consistent scale within their group.
```

---

## 3 — TITLE / KEY-ART manifest

```
Generate a SINGLE 4K image (3840x2160 or larger) containing isolated title/word-art pieces for an undersea treasure slot "Leviathan's Deep". Cinematic AAA slot-game lettering: ornate 3D gold typography, jeweled, with a sea-serpent coiling through the letters, dramatic cyan-and-gold lighting, glossy.

Lay the pieces out separated on a pure solid white (#FFFFFF) flat background, GENEROUS spacing, each piece fully isolated, NO overlap, NO background gradient, NO bleeding shadows, thin dark outline on bright gold so it keys cleanly off white.

Pieces:
1. Main logo wordmark: "LEVIATHAN'S DEEP", serpent wrapping the text
2. Banner: "FREE SPINS"
3. Word-art: "BIG WIN"
4. Word-art: "MEGA WIN"
5. Word-art: "EPIC WIN"
6. Banner: "KRAKEN AWAKENS"
```

---

## Backgrounds & reel frame (9:16 portrait, mobile-first)

The game is **mobile-first, 9:16 portrait**, so these three assets are generated at **4K
portrait (2160×3840)**. The scene and the backplate are full-bleed images (NOT on white — they
are not cut-outs). The reel frame IS a cut-out overlay, so it goes on solid white. Keep all three
in register: the reel grid is **6 columns × 5 rows**, centered horizontally, sitting in the
vertical middle of the screen with room for the title/jackpots above and the bet/spin controls
below.

### 4 — BACKGROUND scene (NO reel frame, full-bleed)

```
Generate a SINGLE 4K PORTRAIT image (2160x3840, 9:16, mobile-first), a full-bleed background for an undersea treasure slot "Leviathan's Deep": a sunken golden temple in a deep teal-to-cyan ocean abyss, god-rays / light caustics from above, drifting bioluminescent particles, coral and ancient pillars. Cinematic, atmospheric, top-studio mobile-slot quality, portrait composition. In the vertical middle leave a clear, slightly darkened rectangular region (about 6-wide by 5-tall proportion) where the reel grid will sit, with breathing room above for a logo/jackpot bar and below for bet controls. NO reel frame, NO reel grid, NO symbols, NO text, NO UI buttons — just the empty scene.
```

### 5 — REEL FRAME (ornate border overlay, on white for keying)

```
Generate a SINGLE 4K PORTRAIT image (2160x3840, 9:16), an ornate decorative REEL FRAME overlay for an undersea treasure slot "Leviathan's Deep". A single rectangular picture-frame border sized for a 6-column by 5-row reel grid, centered, in the vertical middle of a portrait screen. Style: carved golden coral and barnacled treasure-temple stone, jeweled corner ornaments (a kraken eye or trident motif at top center), glossy 2.5D, strong rim light, premium top-studio quality. CRITICAL: render ONLY the frame border on a pure solid white (#FFFFFF) background, with the INSIDE of the frame (the reel window) also pure white and the OUTSIDE pure white — so both the window and the surroundings can be cut to transparent, leaving just the frame ring. Thin dark teal edge on the gold so it keys cleanly off white. NO symbols, NO background scene, NO text.
```

### 6 — REEL BACKPLATE (the panel BEHIND the reels, separate full-bleed image)

```
Generate a SINGLE 4K image, a REEL BACKPLATE panel that sits behind the symbols inside the reel frame for "Leviathan's Deep". A rectangular 6-wide by 5-tall proportioned panel: dark translucent teal sea-glass over ancient temple stone, faint vertical reel-column separators (6 columns), subtle caustic light and a soft inner vignette so bright symbols pop on top. Even, low-contrast, no focal subject, no text, no symbols, no frame border — just the backing surface. Fills the whole image edge to edge.
```
