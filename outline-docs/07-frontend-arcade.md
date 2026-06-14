# 07 - Frontend: Arcade (player app)

`apps/arcade` is the player-facing app. Mobile-first PWA (the real-world reference platforms ship Android APK + mobile web; iOS is rare on these). Players log in with credentials their agent created, see their wallet, play games (placeholder RGS), request recharges from their agent, and request redemptions.

Stack: Next.js 15 App Router as an installable PWA, Tailwind + `packages/ui` arcade sub-theme (`docs/08`), Socket.io client for live balance + round sync, httpOnly refresh cookie auth (`aud: player`). Designed touch-first, single-column, thumb-reachable primary actions. A native SwiftUI client is a viable future path against the same API; nothing here blocks that.

> Players never see anything about the tree, other players, distributors, pricing, revenue, or the ledger internals. Their world is: my balance, games, load up, cash out.

---

## 1. Shell

```
┌─────────────────────────────┐
│ Topbar: balance · profile   │
├─────────────────────────────┤
│                             │
│   Screen content            │
│                             │
├─────────────────────────────┤
│ Tab bar: Play · Wallet ·    │
│          Cash Out · Me      │
└─────────────────────────────┘
```

- **Balance chip** (top, always visible): live wallet balance. In COMPLIANCE mode shows **two** balances — PLAY (gold, for playing) and PRIZE (the redeemable one) — clearly differentiated. In OPERATOR mode, one CREDIT balance. Updates via `balance.changed` on `player:{selfId}`.
- **Tab bar**: Play (lobby), Wallet (recharge), Cash Out (redeem), Me (account). In OPERATOR mode "Cash Out" may be simplified or relabeled per business config.

---

## 2. Screens

### 2.1 Login / onboarding
- Username + password (agent-provisioned). No public self-registration by default (accounts come from a store). If self-signup is enabled later, it slots in here.
- First-login forced password change.
- On login, region check runs (`GeoRule`); a blocked region shows a clean "not available in your area" state and stops (compliance mode).
- 21+ age confirmation gate where required.
- Forgot password → routed through the agent (in this model the agent manages the account) or email if enabled.

### 2.2 Lobby / Play (`/`)
- Grid of game tiles. Each tile = placeholder art + game name + category (fish / slots / keno) + RTP badge optional.
- Categories/filter chips. "Recently played", "Popular" (static or simple counters).
- Tiles are **placeholders** (`docs/05` RGS contract) — tapping opens the game screen which talks to the stubbed RGS. Real games drop in later behind the same interface without changing this screen.
- Banner slot for announcements (from `announcement` event / `Announcement`).
- If balance is zero, a gentle "Load credits" prompt linking to Wallet.

### 2.3 Game screen (`/play/:gameId`)
This is intentionally generic because games are stubbed. It renders the **outcome** the server returns, not real game logic.

- Header: game name, back, current balance.
- Bet controls: bet amount selector (within game min/max from `Game`), spin/play button. In compliance mode, plays draw from PLAY balance.
- Play action: `POST /games/:id/play` with bet + idempotency key → server-authoritative result from `PlaceholderRgsProvider` (`docs/05`). Response includes nonce, outcome json, win amount.
- Outcome render: a simple, honest visualization of the result (win/loss, amount, a basic animation slot). The placeholder marks results `demo:true`. A real RGS would supply richer render data; the screen is built to swap that in.
- Balance updates from the play response and is confirmed by `session.round` / `balance.changed` socket (multi-device sync).
- Provable-fairness drawer: show server seed hash, client seed, nonce so the fairness scheme (`docs/05`) is visible. Good practice and trust-building.
- Responsible-gaming guardrails honored: if a session/loss/time limit (`ResponsibleGamingLimit`) is hit, play is blocked with the reason; self-excluded players can't enter at all.

### 2.4 Wallet / Recharge (`/wallet`)
- Balance summary (PLAY + PRIZE in compliance mode, single CREDIT otherwise) with plain explanation of what each is for.
- **Request recharge**: choose amount (or package tiers), see the offline payment instructions for their agent (cash / app / however that store collects — config per agent), and submit a recharge **request**. This pings the agent (`recharge.requested` → agent's console inbox, `docs/06` §3.7). The agent collects payment offline and pushes credits, which arrive in the player's wallet live.
  - The flow is request-based because **the player never pays a processor in-app** — the agent loads them after offline payment. That is the whole point of the credit model (`docs/03` "no payment processor").
  - In compliance mode the UI frames purchases as buying PLAY credits that come with PRIZE bonus, never selling redeemable credits directly.
- Recharge history list (amounts, time, status).
- Pending request state with status until the agent fulfills.

### 2.5 Cash Out / Redeem (`/cashout`) — primarily COMPLIANCE mode
- Shows redeemable balance (PRIZE) and minimum redemption threshold.
- **Request redemption**: amount, payout method/details (how they want to be paid offline). Submit → creates `RedemptionRequest` (`docs/03` §4.5), which places a hold on PRIZE credits and routes to the approving operator (`docs/04`).
- Status tracking: pending → approved → paid (or rejected with reason, which releases the hold).
- KYC gate (compliance): if not verified, prompt to complete KYC (2.7) before redeeming; surface `KYC_REQUIRED` cleanly.
- Region + self-exclusion gates honored.
- In OPERATOR mode, cashout is whatever the business allows (often handled entirely offline through the agent); this screen adapts or hides per config.

### 2.6 Me / Account (`/me`)
- Profile basics, change password, language.
- **Responsible gaming**: set personal limits (deposit/loss/session/time), see active limits, request self-exclusion (cooling-off periods). Self-exclusion immediately blocks play + recharge and is logged.
- KYC status + start/continue KYC (compliance).
- Transaction history (recharges, plays summary, redemptions) — the player's own activity only.
- Support / contact agent. Logout.

### 2.7 KYC flow (compliance mode)
- Triggered before first redemption (or on demand). Collect required identity fields + document upload (front/back ID, selfie as configured), stored to R2 via signed upload.
- Creates `KycRecord` in pending; status shown to player. Review happens in console compliance queue (`docs/06` §3.11). On approval, redemption unblocks.

### 2.8 Announcements / notifications
- In-app notification list (`Notification`) and banner for active `Announcement`s targeting the player. Arrive via `announcement` socket event.

---

## 3. Cross-cutting player behaviors

- **Two-balance clarity (compliance)**: PLAY vs PRIZE must be visually unmistakable everywhere (color + label + icon from the design system). Players act on PLAY (spend) and PRIZE (cash out). Never blur them.
- **No in-app card payment**: there is no card/checkout UI anywhere. Loading credits is always a request to the agent who collects offline. This is by design (`docs/03`).
- **Server-authoritative everything**: balances, outcomes, limits all come from the server. The client never computes a win or a balance; it renders what the API/socket returns. Reconnect refetches truth.
- **Idempotent actions**: play, recharge-request, and redemption-request each send an idempotency key so retries/double-taps don't double-fire.
- **Guardrails visible, not preachy**: responsible-gaming limits, self-exclusion, age gate, and provable fairness are present and easy to reach, surfaced as normal product, matching how a competent operator ships them.
- **Offline/poor-network tolerance**: PWA caches the shell; actions queue/retry with their idempotency keys; balance reconciles on reconnect.

---

## 4. Component inventory (arcade-specific)

Built on `packages/ui` arcade sub-theme (`docs/08`):
- `BalanceChip` (dual-balance aware), `Money`
- `GameTile`, `GameGrid`, `CategoryChips`
- `GameStage` (generic outcome renderer), `BetControls`, `PlayButton`, `OutcomeDisplay`, `FairnessDrawer`
- `RechargeRequestForm`, `PackageTiles`, `RechargeStatus`, `RechargeHistory`
- `RedeemForm`, `RedemptionStatus`, `RedemptionHistory`
- `KycForm`, `DocUpload`
- `RgLimitsForm`, `SelfExclusionFlow`, `AgeGate`, `RegionBlockedState`
- `AnnouncementBanner`, `NotificationList`
- `TabBar`, `MobileTopbar`

Map onto `docs/05` player-surface endpoints. Build `BalanceChip` + `Money` + `GameStage`/`BetControls` + `RechargeRequestForm` first; the lobby and game loop are the core demo path, and recharge is what makes the credit model tangible.
