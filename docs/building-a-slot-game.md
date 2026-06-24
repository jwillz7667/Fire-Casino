# Building a Slot Game — the Leviathan's Deep playbook

How a full Goldwave/Aureus slot is built, end to end, using **Leviathan's Deep** (`leviathan-deep`) as
the worked reference. Every other live slot (`phoenix`, `royal`, `dragon`, `cosmic`, `kirin`, `inferno`)
follows this same shape — copy it.

A slot is **server-authoritative**: the API decides every outcome over a provable-fairness RNG stream; the
Godot/WASM client only *renders* what the server returns. Money is computed and settled server-side in
integer minor units. The client is a static build hosted on Cloudflare R2 and embedded in the arcade in a
cross-origin iframe that talks to the parent over `postMessage`.

```
                 ┌─────────────────────────── apps/api (NestJS) ───────────────────────────┐
  player spins → │ games.controller → games.service → CompositeProvider → <Game>Provider    │
                 │   → engine.spin(rng)  (rng = createRoundRng(serverSeed,clientSeed,nonce)) │
                 │   → { totalWinBps, outcome }  → winMinor = bps(betMinor, totalWinBps)     │
                 │   → LedgerService double-entry settle → balanceAfterMinor                 │
                 └──────────────────────────────────┬──────────────────────────────────────┘
                                                     │ outcome JSON (shape = shared contract)
   apps/arcade  <Game>Godot.tsx (host) ── postMessage ──> R2 iframe: index.html + <game>-bridge.js
                  owns session/API/balance              Godot WASM renders the outcome
```

---

## 0. The pieces (file map)

For a game with code `<game>` (kebab) and engine key `<game>`:

| Layer | Path | Responsibility |
|-------|------|----------------|
| **Contract** | `packages/shared/src/schemas/<game>.ts` | The PUBLIC outcome shape + symbol ids + game code. Exported from `packages/shared`. NO weights/paytable here. |
| **Math** | `apps/api/src/games/engines/<game>/math.ts` | Reel weights, paytable (bps), feature tables, `PAYOUT_SCALAR_BPS`, `CERTIFIED_RTP_BPS`. Server-only. |
| **Symbols** | `…/<game>/symbols.ts` | Symbol id union + helper sets (paying / wild / scatter…). |
| **Engine** | `…/<game>/engine.ts` | Pure `spin(rng) → { totalWinBps, outcome }`. No I/O, no money types — bps only. |
| **Probe** | `…/<game>/simulate.ts` | Seeded Monte-Carlo CLI that MEASURES RTP / hit freq / buckets and suggests the scalar. |
| **Provider** | `…/<game>/<game>.provider.ts` | `@Injectable` adapter: `play(req) → { winMinor, outcome }`. Bridges engine → money. |
| **Tests** | `…/<game>/engine.test.ts` | Unit tests incl. RTP convergence; assignable-to-contract check. |
| **Register** | `apps/api/src/games/games.module.ts` + `rgs/composite.provider.ts` | Add the provider + map the engine code → provider. |
| **Seed** | `packages/db/prisma/migrations/<ts>_seed_<game>_game/migration.sql` | Insert the catalog row (code, name, thumb, `config`). |
| **Client** | `games/<game>/` | Godot 4.6 project: `project.godot`, `slot/main.tscn`, `slot/slot_machine.gd`, `art/`, `audio/`, `thumb.png`, `export_presets.cfg`. |
| **Bridge** | `games/<game>/web/<game>-bridge.js` | iframe-side postMessage proxy. |
| **Build** | `games/<game>/web/build.sh` | Godot headless export → inject bridge → upload to R2 with correct content-types. |
| **Host** | `apps/arcade/src/components/game/<Game>Godot.tsx` | React host: owns session/API, pins the R2 URL, talks postMessage. |
| **Assets** | `docs/<game>-asset-prompts.md` | The image-gen prompts + asset→symbol mapping. |

---

## 1. The contract (`packages/shared/src/schemas/<game>.ts`)

Only the outcome **shape** and symbol ids are shared. Weights, paytable and RTP are server-only and never
reach the client. Export a game code constant, the symbol list, the outcome interfaces, and a narrowing
`isXOutcome(o): o is XOutcome` guard. The outcome carries:

- the full render data (grids / cascade steps / lines / feature sequences) the client needs to animate,
- `totalWinBps` — **the final, authoritative win in bps of bet, AFTER calibration** (+ any verbatim prize),
- a `feel: SlotFeel` field (presentation-only suspense/win-tier hints; never affects money).

The api-side engine types mirror these and are asserted assignable in the engine test, so the contract
can't silently drift. Money in the contract is **bps of total bet** (`10000 = 1× bet`).

## 2. The math model (`math.ts`)

- All payouts are **integer bps of total bet**. Never floats for money.
- `PAYTABLE` pays per symbol per reels/lines matched, in bps, BEFORE ways-multiplicity and any
  cascade/tide/multiplier.
- **`PAYOUT_SCALAR_BPS`** is the single linear RTP knob: it scales the "scaled slice" (base lines/ways +
  free spins). **Fixed headline prizes** (e.g. the Kraken 20×/75×/300×/1000×, jackpots) are added to the
  total **VERBATIM — never scaled** — so their reveal is always an exact bet-multiple. Realized RTP =
  `scaledRtp(scalar) + fixedSlices`.
- `CERTIFIED_RTP_BPS` declares the target (e.g. `9600` = 96%). RTP is **emergent and MEASURED**, never
  inferred from a constant.
- Feature triggers (scatter count → free spins; bonus count → instant prize) and their awards live here.
- Volatility = the **shape** at a fixed RTP (hit frequency + win-size distribution + feature frequency).
  See `docs/slot-rtp-volatility-spec.md`. **Owner policy: don't reshape an existing game's feel without an
  explicit request — calibrate RTP via the scalar only.**

## 3. Calibrating RTP with the probe (`simulate.ts`)

`simulate.ts` runs a seeded `mulberry32` Monte-Carlo (NOT the fairness stream — just to measure the model)
and prints measured RTP, the scaled vs fixed slices, hit frequency, feature rates, win buckets, max win,
and the exact `PAYOUT_SCALAR_BPS` to land the COMBINED RTP on `CERTIFIED_RTP_BPS`.

> **Gotcha — running the probe.** `tsx` is a *transitive* dependency and is NOT linked into any `.bin`, so
> `pnpm exec tsx` and `pnpm --filter api exec tsx` both fail with `Command "tsx" not found`. Run it via the
> pnpm store path, from the repo root:
> ```bash
> TSX="$PWD/$(find node_modules/.pnpm/tsx@*/ -path '*/tsx/dist/cli.mjs' | head -1)"
> ( cd apps/api && node "$TSX" src/games/engines/<game>/simulate.ts 1000000 )
> ```
> Iterate at 200k spins (fast), confirm at 1–2M. Land within **±0.3%** of `CERTIFIED_RTP_BPS`. The scaled
> slice is linear in the scalar, so `scalar' = scalar × (target − fixedRtp) / scaledRtp` is a one-shot fix.
> After ANY weight/paytable change the scaled slice moves — re-measure and recompute the scalar.

## 4. The engine (`engine.ts`)

A pure function: `spin(rng: () => number) → { totalWinBps, outcome }`. It draws the grid(s) from the reel
weight vectors, evaluates lines/ways, runs cascades/free spins/bonus, applies `PAYOUT_SCALAR_BPS` to the
scaled slice, adds fixed prizes verbatim, clamps to `MAX_WIN_BPS`, attaches `feel` (via the shared
`buildFeel`/`computeAnticipation` helpers), and returns the contract-shaped `outcome` plus the authoritative
`totalWinBps`. No money types, no DB, no framework — just bps and the rng.

## 5. The provider + registration

```ts
@Injectable()
export class LeviathanProvider implements GameProvider {
  play(req: RoundRequest): RoundResult {
    const rng = createRoundRng(req.serverSeed, req.clientSeed, req.nonce); // provable-fairness stream
    const { totalWinBps, outcome } = spin(rng);
    return { winMinor: bps(req.betMinor, totalWinBps), outcome };          // bps → integer minor units
  }
}
export const LEVIATHAN_ENGINE = LEVIATHAN_GAME_CODE; // "leviathan-deep"
```

Register in two places:
- `apps/api/src/games/games.module.ts` — add `LeviathanProvider` to `providers`.
- `apps/api/src/games/rgs/composite.provider.ts` — inject it and map `[LEVIATHAN_ENGINE]: leviathan` so the
  catalog row's `config.engine` string routes a round to this provider.

`bps(betMinor, totalWinBps)` is the shared money helper (`packages/shared`). `1 credit = 1000 minor units`;
the platform DISPLAYS USD (1 credit = $1) but the ledger is always integer minor units. Settlement is a
double-entry `LedgerService` transaction; every credit-moving endpoint takes an idempotency key.

## 6. The Godot client (`games/<game>/`)

A Godot 4.6 project. `slot/slot_machine.gd` is the whole renderer/state-machine. It:

1. On boot asks the host for init (balance/currency/bet bounds), else falls back to an **offline demo** with
   mock outcomes (so the exported build is QA-loadable standalone).
2. On spin, calls `placeBet(betMinor, cb)`; receives the server `outcome`; animates it.

**Key client invariants (learned the hard way):**
- **Drive the WIN counter from the authoritative `outcome.totalWinBps`**, monotonic non-decreasing, landing
  EXACTLY on the total. Do NOT accumulate pre-scalar per-step bps for the displayed figure and do NOT
  "snap down" when a multiplier resolves — that causes the WIN to flash high then shrink. Cosmetic flourishes
  (multiplier orbs flying in) must not write a lower number than already shown.
- Fixed prizes (Kraken/jackpot) count the WIN up by the **verbatim** award.
- Cinematics (e.g. Kraken Awakens: red eye-glow at the frame top-centre, title pop, redder/darker bg +
  backplate hue shift, dramatic cue) must **revert cleanly** so the next spin looks normal.
- Speed control: keep distinct slow/normal/fast scales (consume `DURATION / speed_scale`); verify slow ≠
  normal.
- Validate headless before exporting; Godot catches GDScript parse/type errors (`max()` Variant inference,
  bare identifiers) that aren't obvious in an editor.

## 7. The postMessage bridge protocol

`games/<game>/web/<game>-bridge.js` runs inside the iframe; the host is `<Game>Godot.tsx`. Message NAMES and
SHAPES are identical across all games — only the `source` prefix differs (`<game>-host` / `<game>-game`).
The host origin is locked to the first init message's origin.

| Direction | `source` | `type` | payload |
|-----------|----------|--------|---------|
| game → host | `<game>-game` | `requestInit` | `{}` |
| game → host | `<game>-game` | `placeBet` | `{ betMinor }` + `reqId` |
| host → game | `<game>-host` | `init` | `{ balanceMinor, currency, minBetMinor, maxBetMinor }` |
| host → game | `<game>-host` | `betResult` | `{ outcome, balanceAfterMinor }` + `reqId` |
| host → game | `<game>-host` | `betError` | `{ message }` + `reqId` |

The host (`<Game>Godot.tsx`) owns the session, calls the Aureus API with an idempotency key (retrying once
on a stale session), resolves a CONCRETE `GAME_ORIGIN` from the R2 URL so it validates by origin (not just
`source`), and pushes `init` on iframe load. Standalone (no parent) → the bridge leaves the global undefined
→ demo mode.

## 8. Build + host on R2 (`web/build.sh`)

```bash
GODOT=/Applications/Godot.app/Contents/MacOS/Godot VER=v1 bash games/<game>/web/build.sh
```

The script: `godot --headless --import` → `--export-release "Web" build/index.html` → copies the bridge →
strips `*.import` → uploads `build/*` to `s3://<R2_BUCKET_ASSETS>/<game>/<VER>/` with per-extension
content-types, plus the un-versioned `thumb.png`. R2 creds come from the repo `.env.production`
(`R2_ACCOUNT_ID / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY / R2_BUCKET_ASSETS`).

> **Gotcha — WASM content-type / stuck-loading.** Godot boots via `WebAssembly.instantiateStreaming`, which
> REQUIRES the `.wasm` to be served as `Content-Type: application/wasm`. The R2 (S3) client switches to a
> multipart upload for files over its threshold, and multipart drops the content-type → the WASM is served
> as `application/octet-stream`/`text/plain` and the game hangs on the loading bar. `build.sh` sets
> `aws configure set default.s3.multipart_threshold 512MB` to force a single-part upload that preserves the
> content-type. After upload, verify: `curl -sI <r2>/<game>/<VER>/index.wasm | grep -i content-type`.
> **Gotcha — immutable cache.** R2 objects are uploaded `immutable`, so you MUST bump `VER` on every rebuild
> and re-point the host. The `"Web"` preset is `thread_support=false` ("nothreads"), so it needs no
> COOP/COEP headers and the plain `*.r2.dev` host serves it.

Then bump the pin in `apps/arcade/src/components/game/<Game>Godot.tsx`:
`const R2_GAME_URL = "https://…r2.dev/<game>/<VER>/index.html";` (overridable via
`NEXT_PUBLIC_<GAME>_GAME_URL`).

## 9. Catalog seed (Prisma migration)

Add a data migration `packages/db/prisma/migrations/<ts>_seed_<game>_game/migration.sql` that inserts the
catalog row: `code` (`<game>`), display name, the R2 `thumb.png` URL, and
`config = '{"engine":"<game>","renderer":"<game>"}'::jsonb`. `engine` routes the round server-side
(§5); `renderer` selects the arcade host component. Railway runs `prisma migrate deploy` on deploy
(see the railway-deploy memory: anchor `/games` in `.railwayignore`, force with `railway up --ci` if the
watch-path trap strands a migration).

## 10. Assets & audio

- **Art:** the owner generates images from prompts in `docs/<game>-asset-prompts.md` (Gemini, 4K, all
  symbols/buttons/title on a SINGLE image with a solid white background for keying). A keyer cuts the white
  AND desaturated/near-white smudges (tan checker, grey haze) — cut by brightness + low saturation — and the
  reel frame is isolated by connected-component selection. Background-removal pipeline tooling lives under
  `tools/` (Nano Banana Pro / gemini-3-pro-image).
- **Audio:** `tools/gen-game-audio.py` (ElevenLabs; key at `~/.eleven_key`) generates the cue pack from a
  per-game cue list into `games/<game>/audio/cues/*.{wav,ogg}`.

## 11. Guardrails to hold

- **Bet-independence (compliance red line):** identical odds at every stake and for every player. No
  per-bet/per-player win-rate variation in the engine. Any operator `rtpBps` override is applied OUTSIDE the
  engine, never feeding back into outcome generation.
- **Bonus-win-rate invariant:** every slot's feature must win MORE OFTEN and MORE per spin than base play —
  asserted by `apps/api/src/games/engines/bonus-winrate.test.ts`. Add the new game to it.
- **Feel layer:** populate `outcome.feel` via the shared helpers so the platform's anticipation/win-tier/
  near-miss presentation works uniformly.
- **Session lifecycle (arcade):** leaving a game → lobby, stay logged in; quick app-switch keeps the
  session; backgrounded ≥10 min → forced re-login (`use-game-session.ts`, `auth-context.tsx`).

## 12. Ship checklist

1. Contract in `packages/shared` (+ export); engine + math + symbols + simulate + provider + tests.
2. Calibrate RTP with the probe to `CERTIFIED_RTP_BPS` (±0.3%); `pnpm --filter api test` green incl. the
   bonus-win-rate invariant.
3. Register provider (`games.module.ts` + `composite.provider.ts`).
4. Build the Godot client; `build.sh` to R2; **verify `index.wasm` is `application/wasm`**; bump `VER`.
5. Pin the R2 `VER` in `<Game>Godot.tsx`.
6. Seed migration with `config.engine` + `config.renderer`.
7. Commit, push, deploy (Vercel arcade + Railway API/migrations). Smoke-test: loads past the bar, a spin
   settles, balance updates, the WIN matches `totalWinBps`.

See also: `docs/slot-rtp-volatility-spec.md` (RTP/volatility policy), `CLAUDE.md` (hard rules), and the
per-slot memories.
