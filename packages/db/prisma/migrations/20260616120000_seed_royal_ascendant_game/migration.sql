-- Seed the Royal Ascendant catalog row.
--
-- The deploy pipeline runs `prisma migrate deploy` (Railway preDeployCommand) but
-- NEVER the seed, and the prod DB is only reachable from inside Railway's network,
-- so reference catalog data is added here as a migration. Idempotent:
-- `ON CONFLICT ("code") DO NOTHING` makes it safe to re-run and to coexist with the
-- dev seed (packages/db/prisma/seed.ts), which upserts the same row.
INSERT INTO "games" (
  "id", "code", "name", "type", "status", "rtpBps",
  "minBetMinor", "maxBetMinor", "supportedCurrencies",
  "thumbnailUrl", "config", "sortOrder", "createdAt", "updatedAt"
) VALUES (
  'game_royal_ascendant',
  'royal-ascendant',
  'Royal Ascendant',
  'SLOT'::"GameType",
  'ACTIVE'::"GameStatus",
  9600,
  1000,
  2000000,
  ARRAY['CREDIT', 'PLAY', 'PRIZE']::"Currency"[],
  '/games/royal-ascendant/thumb.png',
  '{"engine":"royal-ascendant","renderer":"royal-ascendant"}'::jsonb,
  1,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
)
ON CONFLICT ("code") DO NOTHING;
