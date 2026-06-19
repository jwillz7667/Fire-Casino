import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { config as loadEnvFile } from "dotenv";
import { hash } from "@node-rs/argon2";
import {
  type Currency,
  GameStatus,
  type OperatorTier,
  type Prisma,
  PrismaClient,
  type SystemAccount,
} from "@prisma/client";

// Load the monorepo root .env (self-contained; harmless no-op when env is set
// directly, e.g. CI/production).
(function loadRootEnv(): void {
  let dir = process.cwd();
  for (;;) {
    if (existsSync(join(dir, "pnpm-workspace.yaml"))) {
      const envPath = join(dir, ".env");
      if (existsSync(envPath)) loadEnvFile({ path: envPath });
      return;
    }
    const parent = dirname(dir);
    if (parent === dir) return;
    dir = parent;
  }
})();

const prisma = new PrismaClient();

const CURRENCIES: Currency[] = ["CREDIT", "PLAY", "PRIZE"];
const SYSTEM_ACCOUNTS: SystemAccount[] = [
  "MINT",
  "REVENUE",
  "REDEMPTION_CLEARING",
  "PROMO",
  "ADJUSTMENT",
  "ROUNDING",
];

const DEV_SEED_PASSWORD = "ChangeMe!Dev123";

/**
 * Resolve the seed password. In production the committed dev default is refused
 * and a strong SEED_PASSWORD is mandatory — never ship/seed admin accounts on a
 * source-controlled credential (security audit S1). Dev/test fall back to the
 * default for convenience.
 */
function resolveSeedPassword(): string {
  const provided = process.env.SEED_PASSWORD;
  if (process.env.NODE_ENV === "production") {
    if (!provided || provided === DEV_SEED_PASSWORD) {
      throw new Error(
        "Refusing to seed production with the default password. Set a strong SEED_PASSWORD (>=12 chars).",
      );
    }
    if (provided.length < 12) {
      throw new Error("SEED_PASSWORD must be at least 12 characters in production.");
    }
    return provided;
  }
  return provided ?? DEV_SEED_PASSWORD;
}

const SEED_PASSWORD = resolveSeedPassword();
const ARGON2_MEMORY_KIB = Number(process.env.ARGON2_MEMORY_KIB ?? "19456");

function hashPassword(plain: string): Promise<string> {
  // @node-rs/argon2 defaults to the Argon2id algorithm.
  return hash(plain, {
    memoryCost: ARGON2_MEMORY_KIB,
    timeCost: 2,
    parallelism: 1,
  });
}

async function seedPlatformSettings(): Promise<void> {
  const settings: { key: string; value: Prisma.InputJsonValue }[] = [
    { key: "PLATFORM_MODE", value: process.env.PLATFORM_MODE ?? "OPERATOR" },
    { key: "CREDIT_MINOR_UNITS", value: Number(process.env.CREDIT_MINOR_UNITS ?? "1000") },
    {
      key: "REDEMPTION_KYC_THRESHOLD_MINOR",
      value: process.env.REDEMPTION_KYC_THRESHOLD_MINOR ?? "50000",
    },
    { key: "DEFAULT_GAME_RTP_BPS", value: Number(process.env.DEFAULT_GAME_RTP_BPS ?? "9400") },
  ];
  for (const s of settings) {
    await prisma.platformSetting.upsert({
      where: { key: s.key },
      update: { value: s.value },
      create: { key: s.key, value: s.value },
    });
  }
}

/** One ledger account per system key per currency, at zero balance. */
async function seedSystemAccounts(): Promise<void> {
  for (const systemKey of SYSTEM_ACCOUNTS) {
    for (const currency of CURRENCIES) {
      const existing = await prisma.ledgerAccount.findFirst({
        where: { ownerType: "SYSTEM", systemKey, currency },
        select: { id: true },
      });
      if (!existing) {
        await prisma.ledgerAccount.create({
          data: { ownerType: "SYSTEM", systemKey, currency, balanceMinor: 0n },
        });
      }
    }
  }
}

interface OperatorSeed {
  username: string;
  displayName: string;
  tier: OperatorTier;
  parent: { id: string; path: string; depth: number } | null;
  pathSegment: number;
  buyUnitPriceCents?: number;
  sellUnitPriceCents?: number;
}

/** Create User + Operator + a zero-balance CREDIT account if missing. */
async function ensureOperator(seed: OperatorSeed): Promise<{ id: string; path: string; depth: number }> {
  const existing = await prisma.operator.findFirst({
    where: { user: { username: seed.username } },
    select: { id: true, path: true, depth: true },
  });
  if (existing) return existing;

  const passwordHash = await hashPassword(SEED_PASSWORD);
  const path = seed.parent ? `${seed.parent.path}.${String(seed.pathSegment)}` : String(seed.pathSegment);
  const depth = seed.parent ? seed.parent.depth + 1 : 0;

  const operator = await prisma.operator.create({
    data: {
      tier: seed.tier,
      displayName: seed.displayName,
      parent: seed.parent ? { connect: { id: seed.parent.id } } : undefined,
      pathSegment: seed.pathSegment,
      path,
      depth,
      buyUnitPriceCents: seed.buyUnitPriceCents,
      sellUnitPriceCents: seed.sellUnitPriceCents,
      user: {
        create: {
          username: seed.username,
          email: `${seed.username}@example.com`,
          passwordHash,
        },
      },
      ledgerAccounts: {
        create: { ownerType: "OPERATOR", currency: "CREDIT", balanceMinor: 0n },
      },
    },
    select: { id: true, path: true, depth: true },
  });
  return operator;
}

async function ensurePlayer(operatorId: string, username: string, displayName: string): Promise<void> {
  const existing = await prisma.player.findUnique({ where: { username }, select: { id: true } });
  if (existing) return;

  const passwordHash = await hashPassword(SEED_PASSWORD);
  await prisma.player.create({
    data: {
      operator: { connect: { id: operatorId } },
      username,
      displayName,
      passwordHash,
      wallets: { create: { ownerType: "PLAYER", currency: "CREDIT", balanceMinor: 0n } },
      kyc: { create: { status: "NONE" } },
    },
  });
}

async function seedDemoTree(): Promise<void> {
  const superAdmin = await ensureOperator({
    username: "superadmin",
    displayName: "Platform Super Admin",
    tier: "SUPER_ADMIN",
    parent: null,
    pathSegment: 0,
    sellUnitPriceCents: 8,
  });

  const distributor = await ensureOperator({
    username: "distributor1",
    displayName: "Demo Distributor",
    tier: "DISTRIBUTOR",
    parent: superAdmin,
    pathSegment: 1,
    buyUnitPriceCents: 8,
    sellUnitPriceCents: 10,
  });

  const store = await ensureOperator({
    username: "store1",
    displayName: "Demo Store / Agent",
    tier: "STORE",
    parent: distributor,
    pathSegment: 1,
    buyUnitPriceCents: 10,
    sellUnitPriceCents: 12,
  });

  await ensurePlayer(store.id, "player1", "Demo Player");
}

async function seedGames(): Promise<void> {
  const games: {
    code: string;
    name: string;
    type: "FISH" | "SLOT" | "KENO" | "TABLE" | "OTHER";
    rtpBps: number;
    minBetMinor: bigint;
    maxBetMinor: bigint;
    supportedCurrencies: Currency[];
    sortOrder: number;
    thumbnailUrl: string | null;
    config: Prisma.InputJsonObject;
    status: GameStatus;
  }[] = [
    {
      // First "originals" game: a provably-fair 30-segment Fortune Wheel with selectable
      // risk (LOW/MEDIUM/HIGH). config.engine routes rounds to apps/api .../engines/wheel;
      // each risk layout means 0.96 (96% RTP). Godot client on R2, served via WheelGodot.
      code: "fortune-wheel",
      name: "Fortune Wheel",
      type: "OTHER",
      rtpBps: 9600,
      minBetMinor: 1000n,
      maxBetMinor: 2_000_000n,
      supportedCurrencies: ["CREDIT", "PLAY", "PRIZE"],
      sortOrder: 0,
      thumbnailUrl: "/games/fortune-wheel/thumb.png",
      config: { engine: "fortune-wheel", renderer: "fortune-wheel" },
      status: GameStatus.ACTIVE,
    },
    {
      // Phoenix Ascendant: real server-authoritative 5×3 / 243-ways engine, but
      // retired from the player lobby (owner's call). Seeded HIDDEN so the row +
      // engine stay available without surfacing in the catalog or play gate. Hidden
      // on existing DBs by migration 20260617200000_hide_phoenix_and_placeholders.
      code: "phoenix-ascendant",
      name: "Phoenix Ascendant",
      type: "SLOT",
      rtpBps: 9600,
      minBetMinor: 1000n,
      maxBetMinor: 2_000_000n,
      supportedCurrencies: ["CREDIT", "PLAY", "PRIZE"],
      sortOrder: 1,
      thumbnailUrl: "/games/phoenix-ascendant/thumb.png",
      config: { engine: "phoenix-ascendant", renderer: "phoenix-ascendant" },
      status: GameStatus.HIDDEN,
    },
    {
      // Second real engine: server-authoritative 5×3 / 243-ways royal slot with a
      // JOKER wild (interior reels) and a CHEST scatter → rising-multiplier free
      // spins. config.engine routes rounds to apps/api .../engines/royal; its
      // measured RTP is 96.0% (engines/royal/simulate.ts).
      code: "royal-ascendant",
      name: "Royal Ascendant",
      type: "SLOT",
      rtpBps: 9600,
      minBetMinor: 1000n,
      maxBetMinor: 2_000_000n,
      supportedCurrencies: ["CREDIT", "PLAY", "PRIZE"],
      sortOrder: 2,
      thumbnailUrl: "/games/royal-ascendant/thumb.png",
      config: { engine: "royal-ascendant", renderer: "royal-ascendant" },
      status: GameStatus.ACTIVE,
    },
    {
      // Third real engine: server-authoritative 5×3 / 25-payline dragon slot with a
      // WILD dragon-crest (interior reels) and a COINS hoard scatter → rising-multiplier
      // free spins. config.engine routes rounds to apps/api .../engines/dragon; its
      // measured RTP is 96.0% (engines/dragon/simulate.ts).
      code: "dragon-hoard",
      name: "Dragon's Hoard Bonanza",
      type: "SLOT",
      rtpBps: 9600,
      minBetMinor: 1000n,
      maxBetMinor: 2_000_000n,
      supportedCurrencies: ["CREDIT", "PLAY", "PRIZE"],
      sortOrder: 1,
      thumbnailUrl: "/games/dragon-hoard/thumb.png",
      config: { engine: "dragon-hoard", renderer: "dragon-hoard" },
      status: GameStatus.ACTIVE,
    },
    {
      // Fourth real engine: server-authoritative 5×3 / 25-payline cosmic slot with a WILD
      // (interior reels), a galaxy SCATTER → rising-multiplier free spins, and a BONUS
      // anticipation feature (2 BONUS → zoom + special spin, 3+ → an instant 20×/100×/500×
      // credit prize with a jackpot siren). config.engine routes rounds to
      // apps/api .../engines/cosmic; measured RTP is 96.16% (engines/cosmic/simulate.ts).
      code: "cosmic-slots",
      name: "Cosmic Spins",
      type: "SLOT",
      rtpBps: 9600,
      minBetMinor: 1000n,
      maxBetMinor: 2_000_000n,
      supportedCurrencies: ["CREDIT", "PLAY", "PRIZE"],
      sortOrder: 1,
      thumbnailUrl: "/games/cosmic-slots/thumb.png",
      config: { engine: "cosmic-slots", renderer: "cosmic-slots" },
      status: GameStatus.ACTIVE,
    },
    {
      // Second "originals" game: a provably-fair 12-row Plinko drop into 13 buckets with
      // selectable risk (LOW/MEDIUM/HIGH). config.engine routes rounds to
      // apps/api .../engines/plinko; each risk curve's binomial-weighted mean is 0.96
      // (96% RTP, measured in engines/plinko/simulate.ts). Godot client on R2 via PlinkoGodot.
      code: "plinko",
      name: "Plinko",
      type: "OTHER",
      rtpBps: 9600,
      minBetMinor: 1000n,
      maxBetMinor: 2_000_000n,
      supportedCurrencies: ["CREDIT", "PLAY", "PRIZE"],
      sortOrder: 3,
      thumbnailUrl: "/games/plinko/thumb.png",
      config: { engine: "plinko", renderer: "plinko" },
      status: GameStatus.ACTIVE,
    },
    // The placeholder catalog games (reef-rumble / golden-depths / lumen-keno) were
    // removed — only real, server-authoritative games ship. Any existing rows are set
    // to HIDDEN by migration 20260617150000_hide_placeholder_games.
  ];
  for (const g of games) {
    await prisma.game.upsert({
      where: { code: g.code },
      update: {
        name: g.name,
        rtpBps: g.rtpBps,
        minBetMinor: g.minBetMinor,
        maxBetMinor: g.maxBetMinor,
        supportedCurrencies: g.supportedCurrencies,
        sortOrder: g.sortOrder,
        thumbnailUrl: g.thumbnailUrl,
        config: g.config,
        status: g.status,
      },
      create: g,
    });
  }
}

async function seedGeoRules(): Promise<void> {
  const rules = [
    { region: "US", action: "ALLOW" as const, reason: "Default allow" },
    { region: "US-WA", action: "BLOCK" as const, reason: "State restriction (demo)" },
    { region: "US-ID", action: "BLOCK" as const, reason: "State restriction (demo)" },
  ];
  for (const r of rules) {
    await prisma.geoRule.upsert({
      where: { region: r.region },
      update: { action: r.action, reason: r.reason },
      create: r,
    });
  }
}

async function seedPromotions(): Promise<void> {
  const promos = [
    {
      code: "WELCOME",
      description: "Welcome PLAY bonus on first recharge",
      currency: "PLAY" as Currency,
      grantMinor: 50_000n,
      isAmoe: false,
      perPlayerLimit: 1,
    },
    {
      code: "AMOE-SWEEP",
      description: "No-purchase PRIZE sweepstakes entry (AMoE)",
      currency: "PRIZE" as Currency,
      grantMinor: 10_000n,
      isAmoe: true,
      perPlayerLimit: 1,
    },
  ];
  for (const p of promos) {
    await prisma.promotion.upsert({
      where: { code: p.code },
      update: {
        description: p.description,
        currency: p.currency,
        grantMinor: p.grantMinor,
        isAmoe: p.isAmoe,
        perPlayerLimit: p.perPlayerLimit,
      },
      create: p,
    });
  }
}

async function seedAnnouncements(): Promise<void> {
  const existing = await prisma.announcement.findFirst({ where: { title: "Welcome to Aureus" }, select: { id: true } });
  if (existing) return;
  await prisma.announcement.create({
    data: {
      title: "Welcome to Aureus",
      body: "New games in the lobby. Load up with your agent and dive in.",
      audience: "PLAYERS",
      active: true,
    },
  });
}

async function main(): Promise<void> {
  await seedPlatformSettings();
  await seedSystemAccounts();
  await seedDemoTree();
  await seedGames();
  await seedGeoRules();
  await seedPromotions();
  await seedAnnouncements();

  const [settings, sysAccounts, operators, players, games, geo, promos] = await Promise.all([
    prisma.platformSetting.count(),
    prisma.ledgerAccount.count({ where: { ownerType: "SYSTEM" } }),
    prisma.operator.count(),
    prisma.player.count(),
    prisma.game.count(),
    prisma.geoRule.count(),
    prisma.promotion.count(),
  ]);

  // Never print the actual password in production logs (security audit S1).
  const passwordNote =
    process.env.NODE_ENV === "production"
      ? "Login password: set via SEED_PASSWORD (not logged)."
      : `Default login password: "${SEED_PASSWORD}".`;
  console.warn(
    `Seed complete: ${String(settings)} settings, ${String(sysAccounts)} system accounts, ` +
      `${String(operators)} operators, ${String(players)} players, ${String(games)} games, ` +
      `${String(geo)} geo rules, ${String(promos)} promotions. ${passwordNote}`,
  );
}

main()
  .catch((err: unknown) => {
    console.error("Seed failed:", err);
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });
