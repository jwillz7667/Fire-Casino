-- RGS-1: provable-fairness provenance for the per-player/agent RTP override.
-- grossWinMinor = the engine's raw win (recomputable from serverSeed + clientSeed +
-- nonce); effectiveRtpBps = the RTP actually applied. winMinor (already present) is
-- the scaled, paid amount = scale(grossWinMinor, effectiveRtpBps, game.rtpBps). With
-- these on the round the commit/reveal verification reproduces the exact paid figure
-- and any per-player tuning is disclosed. Nullable: rounds predating this column
-- carry no provenance.
-- baseRtpBps snapshots the game's certified RTP AT ROUND TIME (game.rtpBps is
-- mutable), so the scale relation winMinor == floor(grossWinMinor * effectiveRtpBps /
-- baseRtpBps) stays verifiable even after the catalog RTP later changes.
ALTER TABLE "game_rounds" ADD COLUMN "grossWinMinor" BIGINT;
ALTER TABLE "game_rounds" ADD COLUMN "effectiveRtpBps" INTEGER;
ALTER TABLE "game_rounds" ADD COLUMN "baseRtpBps" INTEGER;
