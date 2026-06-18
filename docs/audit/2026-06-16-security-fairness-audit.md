# Aureus / Goldwave — Definitive Security & Game-Fairness Audit

Prepared for the owner. All findings cross-checked and de-duplicated across the game-math, provable-fairness, ledger, authN, authZ, injection, infra and compliance auditors, reconciled against the 3M/5M-spin engine simulations. Severities reflect the verifier's final calls (two were down-rated from HIGH→MEDIUM with rationale noted inline).

---

## 1. Executive summary

- **The cryptographic, ledger, and RBAC foundations are genuinely solid.** Argon2id hashing, hashed/rotating refresh tokens with family reuse-detection, fresh-from-DB principal loading, a two-layer subtree isolation model (ScopeGuard + scoped Prisma client), closed zod schemas at every boundary, and a modulo-bias-free HMAC-SHA256 RNG are all correctly built. The problems below are enforcement gaps and missing controls on top of a sound base — not a rotten core.
- **Three CRITICAL issues form a single full-takeover chain and must be fixed before anything else.** A seeded `superadmin` is live in production on the hardcoded source-controlled password `ChangeMe!Dev123`, MFA for admin tiers is enforced client-side only, and there is no server-side account lockout. Together that is a password-only path to `credit.mint`, `ledger.adjust`, and `platform.settings`.
- **Geo-fencing — the make-or-break control for a sweeps platform — is simultaneously unreachable and fail-open.** `assertRegionAllowed` discards its block via a floating `void` promise, and no caller ever supplies a region. A banned jurisdiction is never detected, and even a configured BLOCK rule would not stop the action.
- **The owner's "wins too much" complaint is correctly diagnosed and already solved on paper.** Royal is tuned low-volatility (39.9% hit, 30.3% sub-1x loss-disguised-as-win flood, 734x ceiling, flat tail). A verified medium-volatility re-tune ("Candidate D") lands 27.9% hit, 14.7% sub-1x, a reachable 5000x cap, with RTP held at 96%. Section 2 has the exact numbers.
- **"Provably fair" is currently cosmetic, and the catalog RTP control is decorative for the real engines.** Players can reproduce the RNG stream but not the grid/win, because the weight tables are server-secret with no published verifier — a dishonest server could publish any outcome undetected. Separately, Royal/Phoenix ignore `req.rtpBps` entirely, so the console can "certify" 8200 while the engine keeps paying 96%.
- **The compliance scaffolding is wired at the right points but four of five real controls are inert:** geo (above), AML (no flag is ever created — zero callers), KYC (a stub status flip, no documents/screening), and the DEPOSIT responsible-gaming limit (amount never passed, so never enforced). There is also no age verification anywhere.

**Single most urgent (do today):** rotate the prod `superadmin` password + all `.env.production` secrets; enforce MFA server-side; fix the geo floating-promise. Everything else can follow the roadmap in Section 4.

---

## 2. Game engine re-tune (owner's top concern)

The complaint — "wins way too much" — is a low-volatility profile: too many tiny sub-stake "wins" (LDW flood), a hit on ~2 of every 5 spins, and a 734x ceiling with no headline max-win hook. Real sweeps slots lead with a 2,000–5,000x+ max win and a tighter, punchier hit rate.

### 2.1 Current vs target vs verified re-tune

| Metric | Royal now (3M sim) | Target (medium-vol) | **Candidate D (verified 5M)** | Phoenix ref |
|---|---|---|---|---|
| RTP | 95.67% (model 96.0%) | hold 96.0% | 96.11% → pin to 96.0% | 96.87% |
| Hit frequency | 39.85% | 25–30% | **27.85%** | 34.67% |
| Sub-1x (LDW) | 30.29% | ~14–20% | **14.70%** | 27.10% |
| Dead spins | 60.15% | — | ~57.3% | 65.33% |
| 1–10x | 7.77% | higher | 12.00% | 6.07% |
| 10–100x | 1.69% | ~1% | 1.02% | 1.34% |
| 100x+ | 0.10% | — | 0.128% (+0.001% at 1000x+) | 0.16% |
| Max win | 733.6x | 1000x+ | **5000x cap, ~1-in-2.5M (reachable)** | 2207x |
| FS trigger | 2.40% (1-in-42) | ~1-in-150–250 | 0.74% (1-in-135) | 2.98% |
| Per-spin SD | 7.12 | higher | 10.26 | — |

Root causes of the current profile (all in `apps/api/src/games/engines/royal/math.ts` + `engine.ts`): every one of the 8 grid symbols pays from 3-of-a-kind and the two cheapest royals are the heaviest (`BASE_COMMON` TEN=22, J=19 at `math.ts:34-44`); the JOKER wild on the 3 interior reels (`math.ts:28,60`) widens/completes runs; scatter weight 5 + generous 10/15/20 FS awards make the feature fire 3–6x too often; the FS multiplier is a deterministic ×1..×10 ramp (`engine.ts:156`) that adds zero variance so the tail is flat; and `PAYOUT_SCALAR_BPS=6894` then scales the over-paying raw model down to 96%, compressing the tail into the sub-1x bucket.

### 2.2 Concrete changes (file: `apps/api/src/games/engines/royal/math.ts`, except where noted)

**Base reel weights** — make TEN/J/Q heavy "filler", JOKER interior 4→3:
```
BASE_COMMON = { QUEEN:5, CASTLE:6, SHIELD:8, A:11, K:14, Q:17, J:20, TEN:23, CHEST:3 }
perReel(BASE_COMMON, 3)   // JOKER interior weight 4 → 3
```

**Free-spin reel weights** — JOKER interior 8→7:
```
FREE_COMMON = { QUEEN:7, CASTLE:8, SHIELD:10, A:12, K:13, Q:15, J:17, TEN:19, CHEST:3 }
perReel(FREE_COMMON, 7)   // JOKER interior 8 → 7
```

**Paytable (bps per way)** — TEN/J/Q pay nothing at 3 (this is what kills the LDW flood and drops hit-freq):
```
QUEEN  { 3:12000, 4:50000, 5:250000 }
CASTLE { 3:7000,  4:28000, 5:140000 }
SHIELD { 3:4500,  4:18000, 5:90000  }
A      { 3:2500,  4:9000,  5:40000  }
K      { 3:1800,  4:6500,  5:28000  }
Q      { 3:0,     4:4000,  5:16000  }
J      { 3:0,     4:2800,  5:11000  }
TEN    { 3:0,     4:2200,  5:9000   }
SCATTER_PAY { 3:3000, 4:15000, 5:80000 }
```

**Feature tuning:**
```
FREE_SPINS_AWARD { 3:8, 4:12, 5:18 }
RETRIGGER_SPINS  5 → 4
MAX_FREE_SPINS   50 → 60
MAX_FS_MULTIPLIER 10 → 15
```

**FS multiplier — replace the ×1 ramp with ×2 per spin** at `engine.ts:156` (keep it deterministic so it consumes no RNG and preserves the indexed provable-fair stream):
```
multiplier = Math.min(1 + (spinIndex - 1) * 2, MAX_FS_MULTIPLIER)
```

**Hard max-win cap** at `engine.ts:192`:
```
MAX_WIN_BPS = 50_000_000        // 5000x
totalWinBps = Math.min(MAX_WIN_BPS, Math.floor(rawBps * PAYOUT_SCALAR_BPS / 10_000))
```
The cap binds ~2-in-5M spins (~1-in-2.5M), so it is a genuine rare jackpot event and bounds per-round liability to 5000× max bet — not a routine clip.

**Stop pushing 0-pay win lines** at `engine.ts:117-121` (so filler symbols are truly non-winning at 3 and the render stays clean):
```
const pay = PAYTABLE[sym][k];
if (pay > 0) wins.push({ symbol: sym, count: run, ways, payBps: pay * ways });
```

### 2.3 Mandatory recalibration step (do not skip)

RTP is exactly linear in `PAYOUT_SCALAR_BPS`. After applying the weight/paytable changes:

1. Set `PAYOUT_SCALAR_BPS ≈ 9760` as a starting point.
2. Run `apps/api/src/games/engines/royal/simulate.ts` (recommend extending it first to print per-spin SD via Welford, split the 100-1000x / 1000x+ buckets, and accumulate base-vs-feature RTP).
3. Read the script's printed **"suggested PAYOUT_SCALAR_BPS"** line — that is the source of truth — set it, and re-run to confirm RTP = 96.00% (±0.05).
4. Add a startup assertion that `game.rtpBps === CERTIFIED_RTP_BPS` for engine-backed games (ties into the certification finding below).

Note: Candidate D's base/feature split is 52/48, slightly feature-heavy vs the 60/40 medium ideal. Optional polish: nudge base premiums up and trim the FS award, then re-measure. Not required to satisfy the brief.

---

## 3. Findings by severity

### CRITICAL

| Area | Finding | Location | Current | Risk | Fix | Effort |
|---|---|---|---|---|---|---|
| AuthN | Seeded superadmin on hardcoded source-controlled password, live in prod | `packages/db/prisma/seed.ts:41,155-162,370` | `SEED_PASSWORD` defaults to `ChangeMe!Dev123`; hashed for `superadmin` (SUPER_ADMIN) and printed to logs; per project memory still live | Public username + source-controlled password + no 2FchA = full control of `credit.mint`/`ledger.adjust`/`platform.settings` | Rotate now + force reset on next login; require `SEED_PASSWORD` (fail fast) outside dev or generate per-account OTP; remove plaintext log; boot-refuse if any privileged account matches the default hash | S |
| AuthN | MFA mandated for SUPER_ADMIN/ADMIN but enforced client-side only | `apps/api/src/auth/auth.service.ts:91-97,445`; `access-token.guard.ts:75-114` | Login challenges TOTP only if `mfaEnabled` already true; `requiresMfaEnrollment` is just a response boolean; no guard blocks an unenrolled admin | Password-only login yields a fully privileged session for the seeded superadmin; any bearer client bypasses the console prompt | If `tierRequiresMfa(tier) && !mfaEnabled`, issue only an enrollment-scoped session; in PermissionGuard deny `@RequirePermission` routes for unenrolled admins; backfill enrollment | M |
| Compliance | Geo-fencing non-functional and fails open | `apps/api/src/compliance/compliance.service.ts:178-192`; callers `auth.service.ts:139`, `games.service.ts:137,180`, `wallet.service.ts:62`, `redemptions.service.ts:84,234` | `assertRegionAllowed` is sync and does `void this.applyRegionRule(region)`; the throw escapes as a floating promise; no caller supplies a region; `GEO_PROVIDER=stub` resolves nothing; Player has no region field | Banned jurisdiction never detected; even a configured BLOCK never stops the action. Unreachable AND fail-open — existential for a sweeps platform | Make it `async` and `await applyRegionRule`; resolve a region (IP→region or stored verified region) for every gate; add per-US-state allow/deny, VPN/proxy denial, and continuous in-session re-check | L |

### HIGH

| Area | Finding | Location | Current | Risk | Fix | Effort |
|---|---|---|---|---|---|---|
| Game math | Royal tuned low-volatility (LDW flood, 734x ceiling) | `royal/math.ts:33-108`; `engine.ts:143-192` | Hit 39.9%, sub-1x 30.3%, FS 1-in-42, flat ×1..×10 ramp, no max cap | "Wins too much" UX; uncompetitive vs real sweeps; 30% LDW collides with 2025 over-celebration rules | Apply Candidate D re-tune + recalibrate (Section 2) | M |
| Game math | Real engines ignore catalog `rtpBps` — RTP not configurable/certifiable | `royal/royal.provider.ts:20-24`; `games.service.ts:87-97,294`; `math.ts:105-108` | `play()` never reads `req.rtpBps`; RTP baked into `PAYOUT_SCALAR_BPS`; `updateGame` lets operators set 8000–10000 but engine discards it | Console can "certify" an RTP that diverges from what is paid — certification integrity failure | Either map certified RTP bands → measured scalars per round, OR reject `rtpBps` edits for engine-backed games and surface `CERTIFIED_RTP_BPS` read-only; add boot assertion | M |
| Provable fairness | Outcomes not independently verifiable (weights server-secret, no verifier) | `packages/shared/src/schemas/phoenix.ts:4-6`, `royal.ts:4-5`; `engines/*/math.ts`; `phoenix/engine.ts:63-78` | Reveal reproduces the uniform stream but the grid/win mapping needs secret weights/paytable | Dishonest server can publish any grid/win undetected at reveal — "provably fair" is cosmetic | Publish a versioned, hashed math package, commit its hash with the server seed (`mathVersionHash` in session commit), and ship a verifier that replays grid+win and asserts equality | L |
| AuthZ | AML flag listing leaks across the whole tree | `apps/api/src/compliance/aml.service.ts:41-60`; `compliance.controller.ts:180-188` | `where` is only `{severity?,status?,subjectId?}`; subtree check runs only when `subjectId` present; `AmlFlag` not a scoped model | Any `compliance.manage` holder (delegable down to sub-distributors) lists EVERY AML flag platform-wide incl. PII/amounts — violates hard rule #4 | Denormalize an `ownerPath` onto `AmlFlag` and AND a subtree predicate into every `listFlags`, default-deny — mirror `kyc.service.ts:104-118` | M |
| Infra | No HTTP security headers on the API (helmet absent) | `apps/api/src/main.ts:11-39` | No HSTS / nosniff / Referrer-Policy / X-Frame-Options; `x-powered-by` left on | Downgrade/MITM, MIME-sniff, Referer token leakage on a money API (OWASP A02:2025) | `app.use(helmet())` with HSTS 1y+preload, nosniff, `strict-origin-when-cross-origin`; disable `x-powered-by` | S |
| Infra | No rate limit on the bet endpoint (highest-frequency money route) | `apps/api/src/games/sessions.controller.ts:19-43`; `app.module.ts:50-54` | ThrottlerGuard is opt-in per-route; sessions controller has none; `POST /sessions/:id/bet` unthrottled | Wallet-drain loops; 3 DB txns+locks per bet → cheap Postgres/Redis DoS; idempotency keys don't bound volume | Register ThrottlerGuard as global APP_GUARD, or add `@Throttle` GAMEPLAY_RATE_LIMIT (~120/min/player) to the sessions controller | S |
| Infra | Live production secrets on disk in the working tree | `/Users/willz/ai/Fire-Casino/.env.production:13-28` | Real valid JWT access/refresh secrets, Postgres + Redis passwords, R2 key pair. Gitignored and verified never committed, but present on disk | `JWT_ACCESS_SECRET` is the HS256 key → forge SUPER_ADMIN/player tokens → full auth bypass; DB/Redis/R2 creds give direct store access | Rotate ALL values in Railway, delete the local file; use SOPS/git-crypt/vault if a local copy is ever needed | M |
| Compliance | AML enforcement structurally inert — no flag is ever created | `apps/api/src/compliance/aml.service.ts:92-112`; `compliance.service.ts:117-124` | `createFlag` has zero callers; no monitoring job; controller exposes only list/resolve; `REDEMPTION_KYC_THRESHOLD` is per-redemption (no aggregation) | AML queue is always empty so `assertNoOpenAml` always passes; structuring via sub-threshold redemptions bypasses KYC. AGA 2025 treats sweeps as MSB-equivalent | Wire `createFlag` into a ledger-monitoring worker (velocity/structuring/rapid load→redeem) + manual-flag endpoint; add aggregate CTR(>10k/24h)/SAR(≥5k) thresholds | L |
| Compliance | No age verification (18+/21+) anywhere | `schema.prisma:137-162`; `auth.service.ts:123-167` | Player model has no DOB; no signup/login/KYC age check | Minor-gambling liability — a baseline legal requirement is entirely absent | Add DOB at registration, enforce per-jurisdiction minimum (default 21) before first play/redeem, verify DOB in KYC | M |
| Compliance | DEPOSIT responsible-gaming limit never enforced | `apps/api/src/wallet/wallet.service.ts:62`; `compliance.service.ts:52-61,198-216` | `recharge()` calls `checkDeposit(player.id)` with no `amountMinor`; the DEPOSIT branch is gated on `amountMinor !== undefined`, so it's dead. A passing integration test calls `checkDeposit` directly *with* amount, masking the gap | A configured deposit limit is silently ignored while shown as active protection — violates hard rule #7; false record of protection | One-line fix: `checkDeposit(player.id, { amountMinor: input.amountMinor })`; fix the misleading test; prompt for a limit at first recharge | S |
| Compliance | COMPLIANCE/sweeps mode lacks AMOE + per-state eligibility; PRIZE pegged to purchase | `apps/api/src/wallet/wallet.service.ts:84-120`; `.env.production:21` | `DEFAULT_PRIZE_BONUS_BPS=10000` mints redeemable PRIZE as a fixed 100% of paid PLAY, atomically; no free entry path, no AMOE disclosure, no per-state gate. (Prod runs OPERATOR, so dormant) | Tying sweeps credit proportionally to purchase with no AMOE is exactly the structure states are banning in 2025-26; COMPLIANCE mode is legally defective as built | Before enabling: AMOE engine (equal value+odds), AMOE disclosure everywhere paid options appear, decouple PRIZE from purchase, runtime per-state gate, ≥5yr AMOE retention | L |

### MEDIUM

| Area | Finding | Location | Current | Risk | Fix | Effort |
|---|---|---|---|---|---|---|
| Game math | No max-win cap in engine | `royal/engine.ts:191-192` | No clamp on `totalWinBps` | Unbounded per-round liability; no headline max-win | Add `MAX_WIN_BPS=50_000_000` clamp (covered in Section 2) | S |
| Game math | `waysWins` pushes 0-pay win lines (phantom wins once filler exists) | `royal/engine.ts:117-121` | Pushes wins even when `PAYTABLE[sym][k]===0` | Renders phantom "wins" on filler 3-runs | Guard the push on `pay > 0`; add a unit test (Section 2) | S |
| Provable fairness | Server seed committed AFTER client seed known (grinding) | `games.service.ts:137-150`; `schemas/games.ts:36-41` | Server generates/commits its seed after receiving the client seed | Malicious operator can grind server seeds for favorable outcomes | Commit server seed first (return only its hash), accept client seed strictly after, nonce 1 runs only then | M |
| Provable fairness | Raw `serverSeed` stored plaintext, excluded from redaction | `sensitive-fields.interceptor.ts:14-16`; `schema.prisma:386`; `games.service.ts:216,226` | `serverSeed` plaintext; omitted from `REDACT_KEYS`; secrecy depends on every handler narrowing its select | Any future handler returning a session row leaks the active seed → predictable session | Redact `serverSeed` while session ACTIVE (reveal only ENDED), or encrypt at rest and decrypt only in `endSession` | S |
| Provable fairness | Client "fairness" panel verifies nothing | `apps/arcade/src/components/game/FairnessDrawer.tsx:41-51`; `play/[code]/page.tsx:149` | Drawer only displays seeds | "Verification" is a claim, not a function | Compute `sha256(revealedServerSeed)` in-browser and assert vs the start hash; replay each round via the published math package | M |
| AuthN | No account lockout; brute-force defense is per-IP only, `req.ip` unreliable | `throttler.config.ts:14,29-36`; `main.ts` (no trust proxy); `schema.prisma` User (no lockout fields) | Login 10/min; keyed on `req.ip`; no per-account cap; throttling fully off when `NODE_ENV=test`; `trust proxy` unset so `req.ip`=proxy hop | Present-state: login+refresh share a near-global 10/min bucket (self-DoS) and audit loses attacker-IP attribution; distributed/XFF-spoof is latent if XFF is later trusted (down-rated HIGH→MEDIUM; Argon2id raises per-guess cost) | Per-account Redis backoff keyed on identifier; `app.set('trust proxy', <hops>)`; tighten to 5/min; alert on repeated `auth.login_failed` per identifier; keep throttling testable | M |
| AuthN | 15-min access token has no server-side revocation | `access-token.guard.ts:75-114`; `auth.service.ts:178-184,211-226,412-420` | Logout/password-change/reuse-detection don't kill a live access token | A stolen/compromised token stays valid up to 15 min after revocation events | Maintain a revoked-sessionId/jti set in Redis (TTL=access TTL), check in AccessTokenGuard | M |
| AuthN | TOTP MFA secret stored plaintext (schema claims "encrypted at rest") | `auth.service.ts:295,93,308`; `schema.prisma:36` | `mfaSecret` plaintext; comment falsely claims encryption | DB read discloses MFA seeds → bypass second factor | AES-256-GCM encrypt on write (key from secret/KMS), decrypt only in-memory for `authenticator.check`; fix the comment | M |
| AuthZ | Announcement deactivation has no subtree/ownership check | `notifications/announcements.service.ts:94-105`; `announcements.controller.ts:43-49` | No `@ScopeCheck`; any holder can deactivate cross-branch/global announcements | Cross-branch tampering with operator comms | Load first; assert `isInSubtree(caller.path, operatorScopePath)`; restrict null-scope (global) to SUPER_ADMIN | S |
| AuthZ | Operator KYC submit / doc-url ungated; can downgrade a VERIFIED record | `compliance.controller.ts:254-277`; `kyc.service.ts:43-62` | No permission gate; upsert silently overwrites VERIFIED status | Unauthorized KYC submission / silent re-verification downgrade | Add `@RequirePermission("compliance.manage")` (or `kyc.submit`); don't overwrite VERIFIED without an explicit re-verify path | S |
| Infra | Next.js apps ship no CSP / frame-ancestors / security headers | `apps/arcade/next.config.ts`; `apps/console/next.config.ts` | Only `reactStrictMode`/`transpilePackages`/`eslint.ignoreDuringBuilds`; no `headers()`, no `vercel.json` headers, no middleware (grep-confirmed zero CSP/XFO anywhere) | Console (privileged RBAC) is clickjackable (UI-redress → privileged clicks); no CSP to contain any XSS sink (down-rated HIGH→MEDIUM: clickjacking is the one standalone medium vector) | Add async `headers()`: `frame-ancestors 'none'`/XFO DENY for console; arcade `frame-src` pinned to the R2 game origin; nosniff; `strict-origin-when-cross-origin`; restrictive Permissions-Policy; nonce + `strict-dynamic` CSP | M |
| Infra/Input | Game iframe postMessage bridge trusts wildcard origin (Royal `GAME_ORIGIN="*"`) — *(merged: 2 auditors)* | `apps/arcade/src/components/game/RoyalGodot.tsx:22-32,93-98,168-176` | Origin check skipped; `targetOrigin "*"`; trust rests on a guessable string token | Any framing origin can drive the bridge with a guessed token | Add `if (e.source !== iframeRef.current?.contentWindow) return;`; serve Royal from a pinned origin and re-enable origin checks; apply to Phoenix too | S |
| Infra/Input | Game iframes not sandboxed — *(merged: 2 auditors)* | `PhoenixGodot.tsx:173-180`; `RoyalGodot.tsx:196-204` | No `sandbox` attribute on the Godot iframes | Embedded runtime has full ambient privileges | Add least-privilege `sandbox` (start `allow-scripts`, add only needed tokens; avoid `allow-scripts`+`allow-same-origin` for untrusted builds); pair with CSP `frame-src` | S |
| Infra | Supply-chain CI hardening missing | `.github/workflows/ci.yml`; absent `.github/dependabot.yml` | Actions pinned to mutable `@v4` tags; no `pnpm audit`/secret-scan/SBOM; no Dependabot | Compromised action tag / unscanned CVE / leaked secret slips through | Pin actions to commit SHAs; add gated `pnpm audit`/osv-scanner; gitleaks/trufflehog in CI+pre-commit; CycloneDX SBOM; enable Dependabot/Renovate | M |
| Infra | Docker container runs as root | `Dockerfile:42-46` | Runtime stage has no non-root user | Container breakout → host root; broader blast radius | Add a non-root user (`useradd -r -u 10001 app`, `chown`, `USER app`); keep port >1024 | S |
| Compliance | AuditLog append-only is app-discipline only — no DB enforcement, no tamper-evidence | `schema.prisma:601-619`; `audit.service.ts:34-51` | No trigger/REVOKE; written via full-privilege client; no hash chain | A compromised app role can edit/delete audit history undetected — undermines hard rule #5 | DB trigger raising on UPDATE/DELETE (or REVOKE on `audit_logs`) + `prevHash/rowHash` chain | M |
| Compliance | KYC is a stub — no real verification/document storage/sanctions screening | `kyc.service.ts:43-101,138-141`; `storage.service.ts:22-31`; `compliance.service.ts:127-138` | KYC "decision" is a bare operator status flip; storage presigner is a prod-active stub | No real identity/sanctions/PEP/source-of-funds; `assertKycForAmount` rests on an unverifiable flag | Implement real R2 presigner; integrate identity/liveness + sanctions/PEP behind `KYC_PROVIDER`; capture proof-of-address + SoF; ≥5yr retention | L |
| Compliance | RG limits cannot be updated/removed; raising a limit is silently ineffective | `rg.service.ts:35-63`; `compliance.service.ts:198-216`; `schema.prisma:527-540` | `setLimit` always creates; `assertRgLimit` loops all rows; no unique on `(playerId,type,period)` | Stale rows accumulate; decreases not immediate; no audited relax path | Upsert one row per `(playerId,type,period)` with a unique constraint; decreases immediate, increases pending with cooling-off; audited remove path | M |
| Compliance | Missing RG features: no reality-check / session reminder / cooling-off / first-deposit prompt | `apps/api/src/compliance/` (absent); `compliance.service.ts:219-246` | `assertSessionTime` only blocks; no reminders/time-outs | Falls short of baseline RG expectations (UKGC-style prompts) | Add reality-check intervals, short time-out option, first-deposit limit prompt, surface net win/loss; enforce server-side + audit | M |

### LOW

| Area | Finding | Location | Current | Risk | Fix | Effort |
|---|---|---|---|---|---|---|
| Game math | Sub-credit bets round payouts to zero (RTP erosion at min bet) | `packages/shared/src/money.ts:99-104`; `engine.ts:192` | Floor-toward-house rounding zeroes tiny payouts | Certified RTP erodes at sub-credit bets | Enforce `minBetMinor >= MINOR_PER_CREDIT` for engine games; document floor-toward-house | S |
| Game math | `simulate.ts` lacks SD/volatility metric, coarse tail bucket, single seed | `royal/simulate.ts:30-54` | No SD, no 100-1000x/1000x+ split, no base/feature split | Re-tune verification is harder to certify | Add Welford SD, split tail buckets, base-vs-feature RTP, multi-seed band; keep the "suggested scalar" line | S |
| Provable fairness | Client seed defaults empty, immutable mid-session, no rotation flow | `games.service.ts:147,298`; `schemas/games.ts:39` | `clientSeed ?? ''`; no min; no rotate endpoint | Weak fairness UX; no standard seed rotation | Auto-generate 16 random bytes if none supplied; add client-seed-change / server-seed-rotation (reveal old, commit new, reset nonce) | M |
| Provable fairness | Reveal commitment not cryptographically anchored or scoped to a round set | `games.service.ts:213-229` | Returns seed+hash from the same mutable row | Commitment not signed; covered nonce range not attested | Sign `serverSeedHash‖sessionId‖createdAt` at start; assert `sha256(serverSeed)===hash` before reveal; include covered nonce range | M |
| Provable fairness | Idempotent crash-replay correctness depends on engine purity (load-bearing) | `games.service.ts:264-301` | Replay re-invokes `provider.play` on a non-finalized round | A non-pure provider would diverge on replay | Document/enforce purity; add a byte-identical double-invocation test; persist outcome atomically with the win post | S |
| AuthN | Username enumeration via login timing (Argon2 skipped for unknown users) | `auth.service.ts:79-90,127-138` | No constant-work path when user not found | Account enumeration | Verify against a precomputed dummy Argon2 hash before throwing | S |
| AuthN | JWT verification does not pin the accepted algorithm | `token.service.ts:41-43`; `auth.module.ts:19` | `JwtModule.register({})`; no `algorithms` pin | Algorithm-confusion surface | `verifyAccess(..., { algorithms: ['HS256'] })`; optionally pin iss/aud | S |
| AuthN | Cookie auth routes CSRF-reachable under SameSite=none, no CSRF token | `auth.controller.ts:67-93`; `cookies.ts:15-27`; `.env.production` | `COOKIE_SAMESITE=none` removes browser cross-site protection; no CSRF token | CSRF on `POST /auth/refresh` and `/auth/logout` | Double-submit CSRF token or Origin/Referer allowlist on those routes | S |
| AuthN | Weak password policy and reusable TOTP window | `schemas/auth.ts:8-30`; `auth.service.ts:93,308` | Low min length; TOTP code reusable within window | Weaker credentials; TOTP replay | Raise floor to 12+, add HIBP k-anonymity check for operators; record last TOTP counter to reject reuse; `window:1` | M |
| AuthZ | Ledger-health / transaction-lookup expose platform-wide financials | `reports.controller.ts:78-96`; `reports.service.ts:426-436`; `permissions.ts:64` | `report.ledger_health` is grantable; `lookupTransaction` not subtree-scoped | A delegated finance role reads cross-subtree financials | Remove from `GRANTABLE_PERMISSIONS` (SUPER_ADMIN/ADMIN only) or scope lookup to caller-subtree accounts | S |
| Input | postMessage bridges hand-roll shape checks instead of zod-validating | `PhoenixGodot.tsx:28-34,143-158`; `RoyalGodot.tsx:167-177` | Manual shape checks; Phoenix degrades to `*` origin in dev | Malformed/wrong-window messages slip through | Shared zod discriminated-union schema in `@aureus/shared`, `safeParse` every inbound + the `e.source` check | S |
| Input | Idempotency-Key header has no length/charset bound | `idempotency.decorator.ts:8-16` | Trim only | Oversized/garbage keys accepted | `z.string().min(8).max(200).regex(/^[A-Za-z0-9._:-]+$/)` | S |
| Infra | 49MB Godot WASM/pck committed into git, served same-origin, no integrity check | `apps/arcade/public/royal-ascendant/v3/` | `index.wasm ~36MB`, `index.pck ~12MB` in git | Repo bloat; no tamper-detection on the game binary | Move to R2/CDN (as Phoenix is) by versioned URL or git-lfs; sha256 integrity manifest verified at load; pin origin in CSP | M |
| Infra | Runtime image carries full monorepo, dev deps, CLI tooling | `Dockerfile:42-44` | No prod prune; full workspaces + Prisma CLI in serving image | Larger attack surface + image size | `pnpm deploy --prod`/prune; migrations in a dedicated stage; exclude arcade/console from API runtime | M |
| Infra | Next.js builds ignore ESLint at build time | `apps/arcade/next.config.ts`, `apps/console/next.config.ts` (`eslint.ignoreDuringBuilds:true`) | Build-time lint disabled | Lint regressions can deploy if the CI gate isn't required | Make the GitHub lint check a required status check on Vercel, or re-enable build-time lint | S |
| Compliance | RG value/time checks are read-then-check with no lock (overshoot under concurrency) | `compliance.service.ts:198-246,265-281` | No lock around the limit check | Limit overshoot under concurrent bets | Acceptable given idempotency-keyed single-flight; if tightened, fold into the ledger row-lock transaction | M |
| Compliance | Audit IP is the proxy address; no PII retention/DSAR/encryption policy | `main.ts` (no trust proxy); `audit.service.ts:38-49`; `schema.prisma:487-503,137-162` | `req.ip`=proxy; no retention/DSAR/PII-encryption policy | Lost IP attribution; PII-governance gap | `app.set('trust proxy', …)`; define retention (≥5yr KYC/AML/financial), DSAR workflow, PII encryption/tokenization | M |

### INFO / confirmations (no action required beyond hygiene)

- `COOKIE_SECURE` not enforced in prod; `JWT_REFRESH_SECRET` is dead config — `packages/shared/src/env.ts:26-39`. Fail-closed: require `COOKIE_SECURE=true` (and reject `SameSite=none` without Secure) in prod; remove/document the unused secret.
- `players.update` writes the raw validated body — `players.service.ts:250-252`. Safe only because the schema is closed; map allowed columns explicitly for defense in depth.
- Route/path params accepted as raw strings — `sessions.controller.ts:32,41,46` et al. Optional: wrap in a small zod pipe for consistent 400s.
- Confirmed sound, do not regress: RNG primitive (`rgs/fairness.ts:9-60`), no modulo bias (`engines/*`), nonce/seed anti-reuse via `@@unique([sessionId, nonce])` (`schema.prisma:415`), allowlist CORS + no-leak exception filter + fail-fast env (`main.ts:23-26`, `exception.filter.ts`, `env.ts:85-94`).

---

## 4. Remediation roadmap

### P0 — now (stop the bleeding; full-takeover + legal-existential)

- **Rotate everything compromised.** Prod `superadmin` password + force reset; all `.env.production` values (JWT access/refresh, Postgres, Redis, R2) in Railway; delete the local `.env.production`. *(S+M)*
- **Enforce MFA server-side** for SUPER_ADMIN/ADMIN; deny privileged routes for unenrolled admins; backfill enrollment. *(M)*
- **Fix geo-fencing:** make `assertRegionAllowed` async + `await` the block; wire region resolution into login/play/deposit/redeem. *(L — but the floating-promise fix itself is S; ship that immediately, then the resolver)*
- **Add helmet** to the API and **rate-limit the bet/session routes.** *(S + S)*
- **Fix the DEPOSIT RG limit** one-liner and the masking test. *(S)*

### P1 — this iteration (the owner's headline ask + certification + compliance teeth)

- **Game re-tune (Candidate D) + recalibration** in `royal/math.ts`/`engine.ts/simulate.ts`, incl. max-win cap and the 0-pay-line guard. *(M)* — addresses "wins too much" directly.
- **Certification integrity:** make engines honor `rtpBps` or lock it read-only; boot assertion `rtpBps === CERTIFIED_RTP_BPS`. *(M)*
- **Brute-force + proxy:** per-account Redis backoff, `trust proxy`, tighten login limit, alerting. *(M)*
- **AML teeth:** monitoring worker (velocity/structuring/rapid load→redeem) + manual-flag endpoint + aggregate CTR/SAR thresholds; scope AML flag listing to subtree. *(L + M)*
- **Age verification:** DOB capture + per-jurisdiction min-age gate. *(M)*
- **AuthZ gaps:** announcement subtree check, KYC-submit permission gate + no silent VERIFIED downgrade, ledger-health/lookup scoping. *(S×3)*
- **Next.js + arcade headers/CSP**, postMessage `e.source` + zod hardening, iframe sandbox. *(M + S + S)*
- **Access-token revocation set** in Redis; **TOTP secret + serverSeed encryption/redaction.** *(M + M + S)*

### P2 — before scale / before COMPLIANCE-mode launch (provable-fairness completeness, infra, sweeps legality)

- **Genuine provable fairness:** publish hashed math package + verifier; commit-order fix (server seed first); client-side verification + seed rotation; signed commitment. *(L + M×3)*
- **Real KYC** (R2 presigner, identity/liveness, sanctions/PEP, SoF, ≥5yr retention) and **RG completeness** (upsertable limits with cooling-off, reality-checks, cooling-off/time-out). *(L + M×2)*
- **AuditLog immutability** at the DB layer + hash chain; PII retention/DSAR/encryption policy. *(M×2)*
- **Sweeps legal model:** AMOE engine + disclosure, decouple PRIZE from purchase, per-state runtime gate — gate the COMPLIANCE-mode launch on this. *(L)*
- **Infra hygiene:** CI SHA-pinning + audit/secret-scan/SBOM/Dependabot, non-root Docker + prod-prune, move the 49MB Godot build to R2 with an integrity manifest, make the Vercel lint check required. *(M cluster)*
- Auth polish: pin JWT algorithm, constant-time login, CSRF on cookie routes, stronger password policy + TOTP reuse rejection, `COOKIE_SECURE` fail-closed. *(S/M cluster)*

---

## 5. What's already good (the baseline)

- **Ledger & money model:** integer-minor `BigInt` throughout, floor-toward-house rounding with **no player-exploitable leak**, double-entry discipline. The "wins too much" issue is a tuning choice, not a leak.
- **AuthN crypto:** Argon2id at OWASP minimums; refresh tokens are 48-byte opaque randoms stored only as SHA-256 hashes, rotated every use with **family-based reuse detection** that revokes the whole family on replay; server-generated `familyId` prevents session fixation; access JWT carries only ids while tier/path are re-loaded fresh from the DB every request, so token tampering cannot escalate privileges; strong 32-byte prod secrets; HttpOnly path-scoped refresh cookie with correct cross-site posture.
- **AuthZ:** genuinely two-layered subtree isolation (per-route ScopeGuard + fail-closed scoped Prisma read extension that returns MATCH_NONE on missing context); deny-by-default global guard order (AccessToken → Permission → Scope); the grant system correctly blocks privilege escalation (grants only to strict descendants, never self/super-admin-only/un-held permissions; child-tier creation requires strictly-lower rank); mass-assignment blocked by closed zod schemas + `safeParse`.
- **Input/injection:** every HTTP body/query zod-validated, env fail-fast at boot, Socket.io payloads validated (incl. re-validating Redis JSON), Prisma fully parameterized (only raw is a test-only TRUNCATE over `pg_tables` names), **zero XSS sinks** (`dangerouslySetInnerHTML`/`innerHTML`/`eval`/`new Function` all absent), no SSRF surface, path-traversal-safe storage keys, prototype-pollution-safe settings handling.
- **RNG primitive:** industry-standard Stake-style commit-reveal — 256-bit CSPRNG server seed, SHA-256 commit, `HMAC_SHA256(serverSeed, clientSeed:nonce:index)`, **no modulo bias**, nonce reserved under row-lock + DB unique constraint (no re-roll/reuse), reveal ends the session. The scheme is cryptographically sound; what's missing is the *verifiability layer* on top (the math package + verifier).
- **Infra positives:** allowlist-only CORS with credentials, a no-leak exception filter (Prisma errors never reach clients), fail-fast env validation, Socket.io CORS, lockfile + `--frozen-lockfile`, and no install lifecycle scripts.

The compliance gates are also wired at the *correct decision points* (recharge→checkDeposit, play→checkPlay, redeem→checkRedeem at both request and approval) and self-exclusion + account-status blocks genuinely fire — the work is making the four inert controls actually enforce, not re-architecting where they sit.

---

Key file anchors for the team: game re-tune `apps/api/src/games/engines/royal/{math.ts,engine.ts,simulate.ts}`; provable fairness `apps/api/src/games/{rgs/fairness.ts,games.service.ts}` + `apps/arcade/src/components/game/FairnessDrawer.tsx`; auth `apps/api/src/auth/auth.service.ts` + `packages/db/prisma/seed.ts`; compliance `apps/api/src/compliance/{compliance.service.ts,aml.service.ts,kyc.service.ts,rg.service.ts}` + `apps/api/src/wallet/wallet.service.ts`; infra `apps/api/src/main.ts`, both `next.config.ts`, `Dockerfile`, `.env.production`.