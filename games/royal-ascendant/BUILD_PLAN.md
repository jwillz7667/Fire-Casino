# Royal Ascendant — Build Plan

> A landscape 5×3 / 243-ways slot ("medieval castle/treasury" theme) running as a
> server-authoritative Godot/WASM client on Cloudflare R2, embedded in the Next.js
> arcade iframe — architecturally identical to the live *Phoenix Ascendant*. We
> reuse Phoenix's entire server-authoritative spine and change art + math + landscape
> layout + theme, adding a JOKER wild and a CHEST-scatter rising-multiplier free-spins
> feature.

## Status
- [x] **M0** — Scaffold + asset pipeline (forked trees, `tools/prep-assets.sh`, processed `art/`)
- [x] **M1** — Server engine (`apps/api/src/games/engines/royal`) — 243-ways, JOKER wild (interior reels), CHEST scatter → rising-mult free spins; RTP calibrated 96% (`PAYOUT_SCALAR_BPS=6894`); 10 engine tests green
- [x] **M2** — Self-contained landscape client: castle bg + gold frame + royal symbols (grid calibrated to frame) + buttons; spin/stagger-stop/bounce, win dim+pop+asset-glow, free-spins rising-multiplier, big/mega-win banner+shake; `RoyalGodot` bridge + offline demo
- [x] **M3** — Arcade embed (`RoyalGodot.tsx`) + play-page branch + lobby thumbnail
- [x] **M4** — Web export + bridge inject + **same-origin hosting** in `apps/arcade/public/royal-ascendant/v1/` (R2 swapped for same-origin — no Cloudflare creds needed; env var can still point to a CDN later)
- [~] **M5/M6** — Core juice + audio are folded into the M2 client (stop/win animations, free-spins ramp, 25 SFX + 2 music loops wired). Remaining polish (shaders, ways-trace, module split) deferred
- [ ] **M7** — Polish + prod catalog seed (needs prod DATABASE_URL)

## Naming (locked — one slug everywhere)

| Surface | Value |
|---|---|
| Catalog `code` == engine key == `config.engine` == `config.renderer` | `royal-ascendant` |
| `ROYAL_GAME_CODE` / `ROYAL_ENGINE` | `"royal-ascendant"` |
| Godot project dir | `games/royal-ascendant/` |
| R2 path (versioned) | `royal-ascendant/v1/` |
| Arcade component / env var | `RoyalGodot.tsx` / `NEXT_PUBLIC_ROYAL_GAME_URL` |
| Bridge channels / JS global | `royal-host` / `royal-game` / `window.RoyalGodot` |

Orientation: Phoenix is portrait `720×1280` (`orientation=1`); Royal is **landscape
`1280×720` (`orientation=0`)**, driven by `reel_frame.png` (4509×2510 ≈ 16:9). Every
reel/HUD coordinate in the forked `slot_machine.gd` is portrait-tuned and must be re-laid.

## Symbol contract (server-canonical)

| Id | Source art | Role |
|---|---|---|
| `QUEEN` | `sym_queen.png` (portrait lady) | high |
| `CASTLE` | `sym_castle.png` | high |
| `SHIELD` | `sym_shield.png` | high |
| `A` `K` `Q` `J` `TEN` | `sym_a/k/q/j/ten.png` | low (`Q` = card-queen w/ rose) |
| `JOKER` | `sym_joker.png` | wild (subs all paying, never CHEST; weight 0 on reels 1 & 5) |
| `CHEST` | `sym_chest.png` | scatter (3+ → free spins) |

Renderer loads art at `res://art/symbols/<SymbolId>.png` (uppercase, no lowercasing,
no ART dict) — filenames are normalized in asset prep so the renderer's single scale
constant `CELL*0.92/512` ports verbatim.

## Milestones

### M1 — Server engine live (no client needed)
- NEW `packages/shared/src/schemas/royal.ts` (`ROYAL_GAME_CODE`, `RoyalOutcome`/symbol/grid types, `isRoyalOutcome`); export from `packages/shared/src/schemas/index.ts`.
- `apps/api/src/games/engines/royal/{symbols,math,engine,royal.provider,simulate}.ts` (forked from phoenix).
- Register: `apps/api/src/games/rgs/composite.provider.ts` (`this.engines[ROYAL_ENGINE]=royal`), `games.module.ts` providers.
- Seed: `packages/db/prisma/seed.ts` `seedGames` — add `royal-ascendant` SLOT row, `rtpBps:9600`, `config:{engine,renderer}`.
- Model: 243-ways; wild=JOKER (subs all paying ≠ CHEST, weight 0 reels 1&5); scatter=CHEST 3+ → FS `{3:10,4:15,5:20}`, retrigger +5, cap 50; FS multiplier deterministic rising `min(spinIndex, 10)`; `CERTIFIED_RTP_BPS=9600`, single `PAYOUT_SCALAR_BPS` knob calibrated via `simulate.ts`.
- Tests `engine.test.ts`: RTP convergence <3%, wild sub, wild≠scatter, wild excluded reels 1&5, scatter pay-anywhere, FS gating, multiplier applied, determinism+nonce, shared↔engine `RoyalOutcome` assignability.
- **Done when:** `pnpm --filter api test` green incl. RTP; `pnpm db:seed` upserts; manual bet returns `outcome.kind==="royal-ascendant"`, ledger nets zero.

### M2 — Godot client MVP (renders the outcome, no juice)
- `project.godot`: `viewport_width=1280 viewport_height=720 handheld/orientation=0 config/name="Royal Ascendant"`.
- Geometry in `slot/slot_machine.gd` (calibrate to frame opening — see Risks): `VIEW=(1280,720) COLS=5 ROWS=3 CELL=138 PITCH_X=160 PITCH_Y=152 GRID_TOP=168 GRID_LEFT0=320`, `_reel_x(c)=GRID_LEFT0+c*PITCH_X`.
- Keep single scale const `s=CELL*0.92/512.0` (normalized art).
- `SYMBOL_IDS`/`HIGH`/`WILD="JOKER"`/`SCATTER="CHEST"`; add WILD branch to `_present_win` win-cell build.
- `_build_frame` → `reel_frame.png` TextureRect z=20; `_set_bg` → `STRETCH_KEEP_ASPECT_COVERED`.
- `_build_hud` relayout: readout row + bottom control bar (spin/bet±/maxbet/autospin/info/sound).
- Bridge rename → `window.RoyalGodot`, `web/royal-bridge.js` (`royal-game`/`royal-host`).
- Theme strings + re-themed `_mock_outcome`.
- **Done when:** desktop run spins via mock, renders reels/wins (incl. JOKER sub)/scatter/free-spins in landscape with controls on-screen.

### M3 — Arcade embed + playable locally
- NEW `apps/arcade/src/components/game/RoyalGodot.tsx` (clone `PhoenixGodot.tsx`; change R2 URL, env var, channels).
- EDIT `apps/arcade/src/app/play/[code]/page.tsx` — branch on `game.code === ROYAL_GAME_CODE`.
- `apps/arcade/public/games/royal-ascendant/thumb.png`; `.env.example` `NEXT_PUBLIC_ROYAL_GAME_URL`.
- **Done when:** appears in lobby, `/play/royal-ascendant` debits wallet, engine outcome animates, wallet cache invalidated.

### M4 — Build + R2 deploy (versioned — the Phoenix cache-bug fix)
- `web/shell.html` branded landscape loader; export preset keeps `thread_support=false`, `vram_texture_compression=false`, `canvas_resize_policy=2`.
- `build.sh`: headless import+export, inject `royal-bridge.js` before `</head>`, brotli/gzip `index.{wasm,pck,js}`.
- Upload to `royal-ascendant/v1/` with exact Content-Type/Encoding + `cache-control: public,max-age=31536000,immutable`.
- Set `NEXT_PUBLIC_ROYAL_GAME_URL` (Vercel), prod-seed catalog.
- **Done when:** `curl -sI .../v1/index.wasm` shows `application/wasm` + `content-encoding: br`; prod spin completes.

### M5 — MUST-HAVE juice
First split the 559-line script into modules (`RoyalSlot.gd`, `reels/ReelsController.gd`,
`hud/Hud.gd`, `fx/FxController.gd`, `overlay/Overlay.gd`, `bridge/Bridge.gd`,
`config/RoyalSymbols.gd`). Then implement the 11 must-haves:

1. Spin-start anticipation dip + L→R accelerate.
2. Spin-loop motion blur (texture-swap to `symbols_blur/`).
3. Stagger stop: overshoot bounce + squash + rising-pitch landing thud.
4. **Scatter near-miss anticipation** (≥2 CHEST landed + CHEST ahead — reads real grid, not deceptive).
5. Win: loser dim + winner pop/pulse/glow + gold burst.
6. JOKER wild shimmer + zap (no expand in v1 — server emits no `expandedReels`).
7. Scatter → free-spins trigger sequence + bg crossfade.
8. Free-spins rising-multiplier ramp (number roll + punch).
9. Big/Mega/Epic/Jackpot tiering (8×/20×/50×/100×): banner + screen shake + coin shower + pitch-rising count-up.
10. Button press feedback.
11. Background breathe (+ mandatory texture downscale, done in M0).

Add `shaders/{medallion,reel_blur}.gdshader`; FX scenes in `data/symbol_database.tres`.

### M6 — Audio layer
- `scenes/audio_manager.tscn` + `audio/bus_layout.tres` (Master glue-comp+limiter, Music duck, Hall reverb).
- Cue OGGs in `audio/{music,sfx,ambience,ui}/` (~2MB). **Generated via `slot-icons/audio/generate_sfx.py` (ElevenLabs batch).**
- Hooks: `unlock()` on first tap (iOS-safe), reel spin loop, anticipation riser, scatter/wild lands, coin count-up loop, retrigger + FS outro, sound toggle.
- **Done when:** audio starts after first in-iframe tap, reel stops form a rising pitch ladder, music ducks under wins, mute works, ≤2.2MB.

### M7 — Polish
Ways-trace ribbons + sequenced multi-win cycling; reel-blur shader; JOKER lightning;
frame-based idle/win symbol anims; idle attract loop; layered parallax + torch flicker
+ god-rays + EPIC camera push; tiered music stems. Expanding wild deferred (needs server
`expandedReels`). Re-export bumps to `royal-ascendant/v2/`.

## Asset prep
See `tools/prep-assets.sh`. Source `slot-icons/` → `art/`. Symbols → uniform 512²;
bg 5870×3815 → crop 16:9 → 1920×1080 JPG; frame 4509×2510 → 1536×855 PNG (keep alpha).
`.import`: symbols/bg/frame Lossy q0.9 mipmaps-off; buttons/FX Lossless; **never VRAM mode**.
Never commit raw `slot-icons/` into the build/R2.

## Risks & gotchas
- **Landscape vs portrait** — re-lay every coordinate; keep web-only `if not OS.has_feature("web"): get_window().size=VIEW` guard (forcing window size on web cropped Phoenix's controls).
- **Frame↔grid alignment** — calibrate from the frame opening rect with `kx=1280/4509, ky=720/2510`; expect ±10px tweaks; add a debug `_draw` of clip rects.
- **Download/VRAM budget** — raw bg/frame would upload as ~90MB RGBA and crash low-end WebGL2; downscale before import (done M0); target ≤12MB transfer.
- **R2 cache (Phoenix bug, commit `4f1bc86`)** — Godot ships fixed `index.{wasm,pck,js}`; version the directory, mark immutable, bump on re-export, never overwrite in place. Pre-compress with exact Content-Type/Encoding (wrong type breaks `WebAssembly.instantiateStreaming`).
- **Mobile/WebAudio autoplay** — call `audio.unlock()` synchronously in first `button_tap`; `_ready()` stays silent; portrait rotate-hint in `shell.html`.
- **RTP correctness** — calibrate `PAYOUT_SCALAR_BPS` via `simulate.ts`; seed `rtpBps` must equal `CERTIFIED_RTP_BPS=9600`; convergence test is the CI gate.
- **Contract drift** — server contract canonical (portrait=`QUEEN`, card=`Q`); art filenames must equal engine `SymbolId`s; no `orbValues`, no `expandedReels` in v1; keep the no-client-balance-gate rule.
