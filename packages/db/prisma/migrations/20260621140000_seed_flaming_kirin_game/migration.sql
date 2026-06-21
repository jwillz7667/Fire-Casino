-- Seed the Legend of the Flaming Kirin catalog row.
--
-- The deploy pipeline runs `prisma migrate deploy` (Railway preDeployCommand) but NEVER
-- the seed, and the prod DB is only reachable from inside Railway's network, so reference
-- catalog data is added here as a migration. Idempotent: `ON CONFLICT ("code") DO NOTHING`
-- makes it safe to re-run and to coexist with the dev seed (packages/db/prisma/seed.ts).
-- Bet limits use the current dollar ladder ($0.05–$10 = 50–10000 minor). The Godot build
-- and thumbnail are hosted on Cloudflare R2.
INSERT INTO "games" (
  "id", "code", "name", "type", "status", "rtpBps",
  "minBetMinor", "maxBetMinor", "supportedCurrencies",
  "thumbnailUrl", "config", "sortOrder", "createdAt", "updatedAt"
) VALUES (
  'game_flaming_kirin',
  'flaming-kirin',
  'Legend of the Flaming Kirin',
  'SLOT'::"GameType",
  'ACTIVE'::"GameStatus",
  9600,
  50,
  10000,
  ARRAY['CREDIT', 'PLAY', 'PRIZE']::"Currency"[],
  'https://pub-a2458a29274f4f5ba61f429adf2fcf8f.r2.dev/flaming-kirin/thumb.png',
  '{"engine":"flaming-kirin","renderer":"flaming-kirin"}'::jsonb,
  1,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
)
ON CONFLICT ("code") DO NOTHING;
