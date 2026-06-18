-- Per-agent / per-player RTP overrides (docs/06 §6.1, owner feature).
CREATE TABLE "game_rtp_overrides" (
  "id"          TEXT NOT NULL,
  "gameId"      TEXT NOT NULL,
  "operatorId"  TEXT NOT NULL,
  "playerId"    TEXT,
  "rtpBps"      INTEGER NOT NULL,
  "setByUserId" TEXT NOT NULL,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3) NOT NULL,
  CONSTRAINT "game_rtp_overrides_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "game_rtp_overrides_gameId_operatorId_playerId_idx"
  ON "game_rtp_overrides" ("gameId", "operatorId", "playerId");

-- One override per scope: at most one agent-level (playerId NULL) and one per-player.
CREATE UNIQUE INDEX "game_rtp_overrides_agent_scope_uniq"
  ON "game_rtp_overrides" ("gameId", "operatorId") WHERE "playerId" IS NULL;
CREATE UNIQUE INDEX "game_rtp_overrides_player_scope_uniq"
  ON "game_rtp_overrides" ("gameId", "operatorId", "playerId") WHERE "playerId" IS NOT NULL;

ALTER TABLE "game_rtp_overrides"
  ADD CONSTRAINT "game_rtp_overrides_gameId_fkey"
  FOREIGN KEY ("gameId") REFERENCES "games"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "game_rtp_overrides"
  ADD CONSTRAINT "game_rtp_overrides_operatorId_fkey"
  FOREIGN KEY ("operatorId") REFERENCES "operators"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "game_rtp_overrides"
  ADD CONSTRAINT "game_rtp_overrides_playerId_fkey"
  FOREIGN KEY ("playerId") REFERENCES "players"("id") ON DELETE CASCADE ON UPDATE CASCADE;
