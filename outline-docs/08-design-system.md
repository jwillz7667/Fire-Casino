# 08 - Design System

The design system lives in `packages/ui` and is consumed by both `apps/console` and `apps/arcade`. One token set, two sub-themes layered on top: **Arcade** (vibrant, playful, the player app) and **Console** (dense, calm, fintech-grade back-office). Same DNA, different energy. This is what keeps the platform feeling like one product instead of two bolted-together apps.

## 0. Design thesis

> **Deep-sea bioluminescence meets minted gold.** A dark, deep-water field with light that *emits* rather than reflects, and value rendered as warm minted gold. The credit is the hero, and the credit glows.

This is a deliberate identity, not a default. It avoids the three tired AI-app looks (generic purple SaaS, sterile corporate blue, and the bland Tailwind-gray dashboard). It fits the domain (the reference category is full of underwater fish-table games), it gives money a real visual language (gold = credits/value, with light to signal life and motion), and it scales from a loud arcade tile to a quiet financial table without changing palette.

Spend the boldness in **one** place: the luminous credit/coin motif and the depth-gradient field behind it. Everything else stays restrained so the data and the money read clearly.

---

## 1. Color

All colors are CSS variables (HSL-friendly hex below) defined as design tokens, mapped to Tailwind theme extension. Never hardcode hex in components; use the token.

### 1.1 Base / depth (shared)
The dark field. Console uses the calmer/upper end, Arcade leans deeper for drama.

| Token | Hex | Use |
|---|---|---|
| `--abyss` | `#0A0E1A` | deepest background (arcade canvas) |
| `--trench` | `#0F1626` | app background (console) |
| `--surface-1` | `#161E33` | cards, panels |
| `--surface-2` | `#1E2841` | raised elements, popovers, table headers |
| `--surface-3` | `#26324F` | hover/active surface, inputs |
| `--hairline` | `#2C3A5C` | borders, dividers (low contrast) |
| `--hairline-strong` | `#3A4D78` | stronger separators, focus outlines base |

### 1.2 Brand / accent
| Token | Hex | Meaning |
|---|---|---|
| `--gold` | `#E8B84B` | **primary** — the Aureus credit/value color. Primary actions, balances, brand. |
| `--gold-light` | `#F5D27A` | highlights, gold text on dark, top of coin gradient |
| `--gold-deep` | `#C99A2E` | pressed gold, bottom of coin gradient, gold borders |
| `--lumen` | `#3DD6C4` | **secondary** — bioluminescent teal. Links, secondary actions, "live"/online, info accents, glow. |
| `--lumen-deep` | `#1FA899` | pressed lumen, teal borders |
| `--ember` | `#FF7A59` | **tertiary** — warm coral. Prize/redemption highlights and the subtle nod to "fire". Use sparingly, for the redeemable/prize layer and celebratory moments. |

### 1.3 Semantic
| Token | Hex | Use |
|---|---|---|
| `--success` | `#2FBF71` | positive deltas, paid, approved, verified |
| `--warning` | `#F5A524` | pending, attention, soft caution |
| `--danger` | `#F0476A` | errors, rejected, suspended, insufficient funds |
| `--info` | `#3DD6C4` | informational (aliases lumen) |

Keep `--success` green distinct from `--lumen` teal: success = state, lumen = brand/interactive. Don't use green for links or gold for errors.

### 1.4 Text
| Token | Hex | Use |
|---|---|---|
| `--text-hi` | `#EAF0FF` | primary text, headings |
| `--text-mid` | `#9AA7C7` | secondary text, labels |
| `--text-lo` | `#5E6B8A` | tertiary, placeholders, disabled |
| `--text-on-gold` | `#1A1206` | text on gold fills (dark, for contrast/AA) |
| `--text-on-ember` | `#2A0F08` | text on ember fills |

### 1.5 Currency color language (important)
A consistent rule across both apps so money is instantly readable:
- **Credits / PLAY balance** → gold (`--gold`). The thing you spend.
- **PRIZE / redeemable balance** → ember (`--ember`). The thing you cash out. Visually distinct so players never confuse the two (compliance mode requirement, `docs/07`).
- **Operator credit balance** (console) → gold.
- **Revenue / house** (console reporting) → lumen/teal, to read as "system" not "user money".
- Positive delta → `--success`, negative delta → `--danger`, regardless of currency.

### 1.6 Sub-theme deltas
- **Arcade**: canvas `--abyss`, more glow (see motion/elevation), larger gold presence, depth gradient background active.
- **Console**: canvas `--trench`, glow dialed down to near-zero, denser surfaces, gold reserved for balances + primary actions so dense tables stay calm. Same tokens, just used more sparingly.

Implement as a `data-theme="arcade" | "console"` attribute on the app root; tokens that differ are overridden under each selector. Everything else inherits.

### 1.7 Contrast
Target WCAG AA for text. `--text-hi` on `--surface-1/2` passes. Gold fills use `--text-on-gold` (dark) for AA. Never put `--text-lo` on `--surface-1` for anything important. Financial figures always use `--text-hi` or a semantic color, never `--text-lo`.

---

## 2. Typography

Three families, each with a job. Distinctive but legible; the pairing is part of the identity (don't fall back to system-ui everywhere).

| Role | Family | Use |
|---|---|---|
| **Display** | `Clash Display` (Fontshare) | big headings, hero numbers, game/brand moments. Characterful, slightly geometric. |
| **Body** | `Geist` (Vercel) | UI text, labels, paragraphs, table cells. Clean, modern, neutral. |
| **Mono** | `Geist Mono` / `JetBrains Mono` | all financial figures, IDs, ledger amounts, code. **Tabular numbers on.** |

> **Rule: every monetary value renders in mono with tabular figures** (`font-variant-numeric: tabular-nums`). Balances, ledger entries, prices, deltas. This makes columns of numbers align and read like a real finance product. The `<Money>` component enforces it.

### 2.1 Type scale (rem, 16px base)
| Token | Size / line | Use |
|---|---|---|
| `display-xl` | 3.5 / 1.05 | hero balance, marketing moments (arcade) |
| `display-lg` | 2.5 / 1.1 | page hero numbers, big KPI |
| `h1` | 2.0 / 1.15 | page titles |
| `h2` | 1.5 / 1.2 | section headers |
| `h3` | 1.25 / 1.3 | card titles |
| `body-lg` | 1.125 / 1.5 | emphasized body |
| `body` | 1.0 / 1.5 | default |
| `body-sm` | 0.875 / 1.45 | secondary, table cells |
| `caption` | 0.75 / 1.4 | labels, meta, badges |
| `mono-lg` | 1.5 / 1.2 | big balance figures |
| `mono` | 1.0 / 1.4 | inline amounts, IDs |
| `mono-sm` | 0.8125 / 1.4 | dense table amounts |

Weights: Display 500/600, Body 400/500/600, Mono 400/500. Headings use `--text-hi`; labels use `--text-mid` and often `caption` + uppercase + letter-spacing `0.04em` for the fintech label feel in console.

---

## 3. Spacing, radius, layout

### 3.1 Spacing scale (4px base)
`0, 1=4, 2=8, 3=12, 4=16, 5=20, 6=24, 8=32, 10=40, 12=48, 16=64`. Use the scale, not arbitrary px. Console is denser (default gap 12-16), Arcade is roomier (default gap 16-24).

### 3.2 Radius
| Token | px | Use |
|---|---|---|
| `--r-sm` | 6 | inputs, badges, small buttons |
| `--r-md` | 10 | buttons, cards (console) |
| `--r-lg` | 16 | cards (arcade), modals, game tiles |
| `--r-xl` | 24 | hero/feature surfaces (arcade) |
| `--r-full` | 9999 | pills, balance chips, avatars |

Arcade leans on `--r-lg`/`--r-xl` for a softer, gamier feel; console leans `--r-md` for tighter, more serious surfaces.

### 3.3 Layout
- Console: fixed sidebar (240px) + topbar (56px) + fluid content, max content width ~1440 with comfortable table gutters.
- Arcade: single column, max width ~480 (phone-first), tab bar (64px) + topbar (56px), content scrolls between.
- 8px grid alignment throughout.

---

## 4. Elevation, glow, depth

This is where the two themes diverge most and where the signature lives.

### 4.1 Shadows (console, restrained)
| Token | Value (concept) | Use |
|---|---|---|
| `--e-1` | subtle drop, low blur | cards |
| `--e-2` | medium drop | popovers, dropdowns |
| `--e-3` | large soft drop | modals |

Dark-theme shadows are mostly darkening + a 1px top hairline highlight (`--hairline-strong` at low alpha) to fake a lit edge. Keep them quiet in console.

### 4.2 Glow (arcade + accents)
Light *emits* here. Glow = colored box-shadow/blur, used intentionally:
- `--glow-gold`: gold outer glow on the credit motif, primary CTA hover, balance emphasis.
- `--glow-lumen`: teal glow on "live"/active states, online dots, focus on interactive elements.
- `--glow-ember`: ember glow on prize/redemption highlights and win moments.

Console uses glow *only* for focus rings and the occasional live indicator. Arcade uses it on the credit motif, game tiles on press, and win states. Never glow everything; glow signals "this is alive/valuable/interactive".

### 4.3 Depth-gradient field (the background)
The signature backdrop. A vertical gradient from `--abyss` (top) deepening slightly toward the bottom, with a faint radial "light from above" near the top and optional very-low-opacity particle/caustic texture. Arcade runs this full-bleed behind the lobby and game stage. Console uses a flattened, near-flat version of it as the app background so the two share a horizon line without console getting noisy.

---

## 5. The signature element: the Aureus mark

One bold, memorable object that ties the brand together: a **minted coin that glows**.

- A circular gold token with a subtle struck/minted bevel: gradient from `--gold-light` (top-left) through `--gold` to `--gold-deep` (bottom-right), a thin `--gold-deep` rim, and a soft `--glow-gold` halo.
- Used as: the app icon, the balance chip's leading glyph, the loading/spinner (a slowly rotating coin), empty-state art, and the "credits" visual anywhere credits are shown.
- In motion (arcade): the coin has a slow specular sweep (a light band crossing the face) on idle and a brighter glow pulse on a win/recharge.
- PRIZE/redeemable value uses an **ember-tinted** variant of the same mark so the two currencies share a shape but differ in color (reinforcing §1.5).

This is the one place to be expressive. It shows up small and often, so it does a lot of brand work cheaply, and it makes "value" feel tangible without leaning on slot-machine clichés.

---

## 6. Motion

| Token | Duration / ease | Use |
|---|---|---|
| `--motion-fast` | 120ms ease-out | hover, small state changes |
| `--motion-base` | 200ms ease-out | most transitions, dropdowns |
| `--motion-slow` | 320ms ease-in-out | modals, page/section transitions |
| `--motion-celebrate` | 600-900ms | win/recharge moments (arcade only) |

Principles: motion confirms actions (balance ticks up with a brief count-up animation + gold glow pulse on recharge/win), never blocks. Console motion is minimal and quick. Arcade can be playful (coin sweep, tile press spring, win glow) but still fast and non-nauseating. Respect `prefers-reduced-motion`: drop the count-up/sweeps to instant.

---

## 7. Core components (shared primitives in `packages/ui`)

Each ships themed for both sub-themes via tokens. Build these first; both apps compose them.

- **Money** — renders a `BigInt` minor-unit value via `fromMinor`, mono + tabular, currency-colored per §1.5, optional delta arrow + semantic color. The single source of money rendering. Never format money outside this.
- **MoneyInput** — human-credit input, converts to minor units on change, no float math, currency-aware, min/max.
- **CoinMark** — the signature coin (§5), sizes xs→xl, gold or ember variant, optional glow/animate props.
- **BalanceChip / BalancePill** — coin + Money, live-updating, dual-balance aware (PLAY gold + PRIZE ember).
- **Button** — variants: `primary` (gold fill, dark text), `secondary` (lumen outline/ghost), `ghost`, `danger`; sizes sm/md/lg; loading state uses the spinning coin.
- **Card / Panel / Surface** — token-driven surfaces with the hairline-highlight top edge.
- **DataTable** — sortable, cursor-paginated, scoped fetch, row actions, sticky header (`--surface-2`), tabular money columns. Console workhorse.
- **Input / Select / Textarea / Toggle / Checkbox / Radio** — dark-field form controls, `--surface-3` fill, lumen focus glow.
- **Badge / Tag / StatusPill** — semantic-colored (pending=warning, approved/paid=success, rejected/suspended=danger, live=lumen).
- **Modal / Drawer / Popover / Tooltip** — elevation per §4.1.
- **Dialog: ConfirmMoneyDialog** — the before/after-balance confirm used on every money movement; ReasonDialog for audited overrides.
- **KpiStat** — label (caption/uppercase) + big mono value + delta.
- **Chart primitives** — line/bar/area with the palette (gold series for credits, ember for prize, lumen for revenue/system, semantic for deltas). Dark-grid, tabular axis labels.
- **Tabs / SegmentedControl, Sidebar / Nav, Topbar, TabBar (mobile)**.
- **Toast / Notification, Skeleton / Loading (coin spinner), EmptyState (coin art), ForbiddenState, RegionBlockedState**.
- **Avatar, IconButton, Pagination, SearchInput, DateRangePicker**.

Icons: a single consistent set (e.g. Lucide), `--text-mid` default, accent-colored when meaningful.

---

## 8. Accessibility + quality bar

- AA contrast on all text (§1.7). Focus visible on every interactive element (lumen ring, `--hairline-strong` base).
- Hit targets ≥ 44px on arcade (touch). Keyboard navigable console (tables, menus, dialogs).
- `prefers-reduced-motion` honored. Color is never the only signal (pair with icon/label, e.g. PLAY/PRIZE also differ by label + coin variant, not just gold vs ember).
- Money never truncated or rounded in a misleading way; `<Money>` shows full precision per currency.
- Loading and error states designed, not afterthoughts (skeletons, the coin spinner, clean error/forbidden/region-blocked states).

---

## 9. Token delivery

Define tokens once as CSS variables in `packages/ui/styles/tokens.css` (with `:root` defaults + `[data-theme="arcade"]` / `[data-theme="console"]` overrides), and mirror them into the Tailwind config theme extension so utilities and tokens stay in sync. Components reference Tailwind classes bound to the tokens (e.g. `bg-surface-1`, `text-text-hi`, `text-gold`). Fonts loaded via `next/font` (Geist, Geist Mono local/npm; Clash Display from Fontshare). Ship a small Storybook or a `/dev/styleguide` route rendering every component in both themes so the system is verifiable at a glance.

This is the comprehensive, professional system the platform is built on: one coherent identity, two tuned surfaces, money as a first-class visual citizen, and exactly one place (the glowing coin on a deep field) where it gets to show off.
