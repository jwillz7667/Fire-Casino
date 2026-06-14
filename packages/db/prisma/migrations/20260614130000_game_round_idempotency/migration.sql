-- AlterTable: client bet idempotency key on a game round (nullable, unique)
ALTER TABLE "game_rounds" ADD COLUMN "idempotencyKey" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "game_rounds_idempotencyKey_key" ON "game_rounds"("idempotencyKey");
