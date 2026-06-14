# 04 - RBAC and the Distribution Tree

Who can do what, and how the subtree boundary is enforced. The money rules in `docs/03` assume the scope checks here are airtight. When `03` and this doc seem to overlap, `03` governs the entries, this doc governs who is allowed to trigger them.

---

## 1. The tree

Operators form a strict tree. Each operator has exactly one parent (except the root super admin) and any number of children. A player hangs off exactly one operator (always a `STORE`, the retail agent).

```
SUPER_ADMIN (depth 0, the only root, holds the mint right)
└─ ADMIN (platform staff, scoped powers, no mint unless granted)
└─ MASTER_DISTRIBUTOR (optional)
   └─ DISTRIBUTOR
      └─ SUB_DISTRIBUTOR (optional)
         └─ STORE  (a.k.a. agent — the only tier that owns players)
            └─ PLAYER (leaf, not an operator)
```

Tiers are flexible. A deployment can collapse the optional tiers (run SUPER_ADMIN → DISTRIBUTOR → STORE). The rule that matters: **a node can only create children of a strictly lower tier**, and **only `STORE` nodes can create players**. Enforce tier ordering with a numeric rank.

```ts
const TIER_RANK = {
  SUPER_ADMIN: 0, ADMIN: 1, MASTER_DISTRIBUTOR: 2,
  DISTRIBUTOR: 3, SUB_DISTRIBUTOR: 4, STORE: 5,
};
// a node may create a child with rank > its own rank
// only STORE (rank 5) may create players
```

### Materialized path
Each operator stores `path` (e.g. `0.2.5.11`) and `depth`. `pathSegment` is a small integer unique among siblings, assigned at creation under a parent row lock (`max(siblingSegment)+1`). The path is the concatenation of ancestors' segments plus its own.

- "Everyone in my subtree": `WHERE path LIKE '{myPath}.%' OR path = '{myPath}'`
- "Am I an ancestor of X": `X.path startsWith myPath + '.'`
- "My direct children": `WHERE parentId = myId`

Keep the path updated if a node is ever moved (rare; see §6). For v1, nodes don't move.

---

## 2. Scope: the one boundary that matters

**An operator can see and act only within its own subtree.** A distributor sees its sub-distributors, their stores, those stores' players, and all the credit movement inside that branch. It cannot see siblings, cousins, or anything above it.

Enforced in three layers:

1. **`ScopeGuard` (controller-level).** Resolves the caller's `path` (cached), then for any `operatorId`/`playerId` in the request, loads the target's path and asserts `target.path` starts with `caller.path`. Reject with 403 otherwise. For list endpoints, inject the path filter rather than checking a single id.

2. **Prisma middleware (data-level).** A middleware on `Operator` and `Player` reads (and their dependent reads: ledger accounts, redemptions, sessions, orders) injects `path LIKE caller.path%` / `operator.path LIKE caller.path%`. This catches any query that forgot the guard. The middleware reads the caller scope from an async-local-storage request context.

3. **Outbox/socket rooms.** A principal can only join rooms inside its subtree (§ realtime in `docs/01`). Even if a query leaked, realtime fan-out won't cross branches.

`SUPER_ADMIN` has root path, so its subtree is everything. `ADMIN` is scoped to whatever branch it's attached to (usually directly under super admin, so effectively global-minus-mint), but powers are still gated by the permission matrix below.

---

## 3. Permission matrix

Permissions are checked by a `@RequirePermission('...')` decorator plus the scope guard. A permission grants the *ability*; scope limits the *targets*.

| Permission | SUPER_ADMIN | ADMIN | MASTER_DIST | DISTRIBUTOR | SUB_DIST | STORE |
|---|---|---|---|---|---|---|
| `operator.create_child` | ✓ | ✓ | ✓ | ✓ | ✓ | – |
| `operator.suspend` (in subtree) | ✓ | ✓ | ✓ | ✓ | ✓ | – |
| `operator.set_pricing` (children) | ✓ | ✓ | ✓ | ✓ | ✓ | – |
| `operator.view_subtree` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `credit.mint` (issue from MINT) | ✓ | grant-only | – | – | – | – |
| `credit.transfer_down` | ✓ | ✓ | ✓ | ✓ | ✓ | – |
| `order.request_up` (buy credits from upline) | – | ✓ | ✓ | ✓ | ✓ | ✓ |
| `order.fulfill` (approve a child's order) | ✓ | ✓ | ✓ | ✓ | ✓ | – |
| `player.create` | – | – | – | – | – | ✓ |
| `player.recharge` | – | ✓* | – | – | – | ✓ |
| `player.suspend` | – | ✓ | – | – | – | ✓ |
| `redemption.approve` | ✓ | ✓ | cfg | cfg | cfg | ✓ |
| `redemption.settle` | ✓ | ✓ | cfg | cfg | cfg | ✓ |
| `game.configure` (catalog, RTP) | ✓ | ✓ | – | – | – | – |
| `game.rtp_override` (within bounds) | ✓ | ✓ | cfg | cfg | – | – |
| `compliance.manage` (geo, KYC, AML) | ✓ | ✓ | – | – | – | – |
| `ledger.adjust` | ✓ | – | – | – | – | – |
| `platform.settings` (mode, thresholds) | ✓ | – | – | – | – | – |
| `audit.view` | ✓ | ✓ | subtree | subtree | subtree | subtree |
| `report.view` | ✓ | ✓ | subtree | subtree | subtree | subtree |

Legend: ✓ allowed, – not allowed, `cfg` allowed only if enabled in that operator's `settings` (e.g. a distributor approving its agents' redemptions), `grant-only` off by default but `SUPER_ADMIN` can grant it, `subtree` allowed but scoped to own branch, `*` only if the admin is acting on a player within an assigned branch.

Store this as a static map in `packages/shared/permissions.ts`, plus a per-operator overrides blob in `Operator.settings.permissions` for the `cfg` cases. The check is: `hasBasePermission(tier, perm) || hasGrant(operator, perm)`.

### Who approves redemptions?
Default: the **owning STORE** approves and settles its own players' redemptions (it's the one holding the cash relationship). A deployment can require upline approval above a threshold by setting `settings.redemptionApproval = { thresholdMinor, approverTier }`. Above the threshold the request routes to the named ancestor's queue. Build store-approval first, threshold-routing as a setting.

---

## 4. Account lifecycle

### Creating an operator (a child node)
1. Caller must have `operator.create_child` and the new tier must rank below the caller's tier.
2. In one transaction: create `User` (with a temp password the caller sets), create `Operator` with `parentId = caller`, assign `pathSegment` under a parent lock, compute `path`/`depth`, create its `LedgerAccount(s)` at zero, set default pricing (inherit caller's `sellUnitPriceCents` as the child's `buyUnitPriceCents`).
3. Audit `operator.create`. The child logs in, changes password, optionally enables MFA.

### Creating a player (STORE only)
1. Caller is a `STORE` with `player.create`.
2. Create `Player` (username + initial password set by the agent, exactly like the real platforms), `operatorId = caller`, wallet account(s) at zero, an empty `KycRecord` (status `NONE`).
3. Audit `player.create`. Agent hands the player their username/password.

### Suspending
- Suspending an operator cascades a "frozen" effect to its whole subtree (no transfers in/out, no recharges, no new children) without deleting anything. Implement as a status check that walks up the path: an action is blocked if any ancestor is `SUSPENDED`. Cache the nearest-suspended-ancestor result.
- Suspending a player blocks login, play, recharge, and redeem. Existing balances are preserved.

### Closing
- `CLOSED` is terminal. Require zero balance (or sweep remaining credits up to the parent via a transfer) before closing an operator. Closing a player requires zero redeemable balance (force-redeem or zero it via audited adjustment first). Never hard-delete financial entities.

### Transferring a player to a different agent
Allowed for `ADMIN`/`SUPER_ADMIN` (and optionally the current owning distributor within its subtree). Update `Player.operatorId`, move the wallet relationship, audit `player.transfer`. The player's history stays intact.

---

## 5. Pricing and margin (reporting only, not ledger)

Each operator has `buyUnitPriceCents` (what it pays upline per credit) and `sellUnitPriceCents` (default it charges children/players). These drive:
- The `totalCents` on `CreditOrder`s and the `Settlement` cash positions.
- Margin reports: `(sell - buy) * volume` per operator and per branch.

The ledger never reads these. They exist so the console can show "you made $X this week" and so cash reconciliation has expected values. Agents can override the per-player recharge price at recharge time (recorded on the recharge event for reporting); it still moves raw credits in the ledger.

---

## 6. Moving nodes (future, document the approach)

If you later allow re-parenting an operator (e.g. reassigning a distributor's branch), you must: lock the moving subtree, recompute `path`/`depth` for the node and all descendants (a single `UPDATE ... SET path = replace(path, oldPrefix, newPrefix)` plus depth delta), reassign `pathSegment` under the new parent, and audit it. Validate the new parent ranks above the moved node and isn't inside the moved subtree (no cycles). For v1, disable moves.

---

## 7. Defense-in-depth summary

The subtree boundary is enforced by the guard, the Prisma middleware, and the socket room rules. Tier ordering is enforced on create. The permission matrix gates abilities. The audit log records every privileged action. Money correctness (separate concern) is enforced by the ledger. A single layer failing should not breach isolation, because two others still hold. Test the guard and middleware with a "cousin cannot read cousin" case and an "agent cannot recharge another agent's player" case.
