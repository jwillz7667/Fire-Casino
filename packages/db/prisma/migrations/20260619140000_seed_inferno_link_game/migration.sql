-- Seed the Inferno Link catalog row.
--
-- The deploy pipeline runs `prisma migrate deploy` (Railway preDeployCommand) but NEVER
-- the seed, and the prod DB is only reachable from inside Railway's network, so reference
-- catalog data is added here as a migration. Idempotent: `ON CONFLICT ("code") DO NOTHING`
-- makes it safe to re-run and to coexist with the dev seed (packages/db/prisma/seed.ts).
INSERT INTO "games" (
  "id", "code", "name", "type", "status", "rtpBps",
  "minBetMinor", "maxBetMinor", "supportedCurrencies",
  "thumbnailUrl", "config", "sortOrder", "createdAt", "updatedAt"
) VALUES (
  'game_inferno_link',
  'inferno-link',
  'Inferno Link',
  'SLOT'::"GameType",
  'ACTIVE'::"GameStatus",
  9600,
  1000,
  2000000,
  ARRAY['CREDIT', 'PLAY', 'PRIZE']::"Currency"[],
  '/games/inferno-link/thumb.png',
  '{"engine":"inferno-link","renderer":"inferno-link"}'::jsonb,
  1,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
)
ON CONFLICT ("code") DO NOTHING;
