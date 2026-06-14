import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from "@nestjs/common";
import { Prisma, type PrismaClient } from "@aureus/db";
import { type Env } from "@aureus/shared";
import { ENV } from "../config/config.module";
import { PRISMA_SYSTEM } from "../prisma/prisma.module";
import { RedisService } from "../redis/redis.service";
import { REALTIME_RELAY_CHANNEL } from "./room-access";

interface ClaimedEvent {
  id: string;
  type: string;
  payload: unknown;
  rooms: string[];
  attempts: number;
}

const BATCH_SIZE = 100;
const MAX_BATCHES_PER_TICK = 10;
const MAX_ATTEMPTS = 5;
const TX_TIMEOUT_MS = 15_000;

/**
 * Transactional outbox relay (docs/01 §5). Every realtime event is written as an
 * OutboxEvent row in the same DB transaction as the state change; this worker
 * loop claims PENDING rows with `FOR UPDATE SKIP LOCKED` (safe to run on
 * multiple worker replicas), publishes each to the Redis relay channel the web
 * gateways subscribe to, then marks the row SENT in the same transaction —
 * at-least-once delivery. A row that fails to publish MAX_ATTEMPTS times is
 * parked as FAILED.
 */
@Injectable()
export class OutboxRelayService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(OutboxRelayService.name);
  private timer?: NodeJS.Timeout;
  private running = false;
  private stopped = false;

  constructor(
    @Inject(PRISMA_SYSTEM) private readonly prisma: PrismaClient,
    @Inject(ENV) private readonly env: Env,
    private readonly redis: RedisService,
  ) {}

  onModuleInit(): void {
    this.scheduleNext();
  }

  onModuleDestroy(): void {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
  }

  private scheduleNext(): void {
    if (this.stopped) return;
    this.timer = setTimeout(() => {
      void this.tick().finally(() => this.scheduleNext());
    }, this.env.OUTBOX_RELAY_INTERVAL_MS);
  }

  /** Drain up to MAX_BATCHES_PER_TICK batches; re-entrancy-guarded. */
  async tick(): Promise<void> {
    if (this.running || this.stopped) return;
    this.running = true;
    try {
      for (let i = 0; i < MAX_BATCHES_PER_TICK; i++) {
        const claimed = await this.relayBatch();
        if (claimed < BATCH_SIZE || this.stopped) break;
      }
    } catch (err) {
      this.logger.error(`outbox relay tick failed: ${this.describe(err)}`);
    } finally {
      this.running = false;
    }
  }

  /** Returns the number of rows claimed in this batch (0 means the queue is empty). */
  private async relayBatch(): Promise<number> {
    return this.prisma.$transaction(
      async (tx) => {
        const claimed = await tx.$queryRaw<ClaimedEvent[]>(Prisma.sql`
          SELECT "id", "type", "payload", "rooms", "attempts"
          FROM "outbox_events"
          WHERE "status" = 'PENDING'
          ORDER BY "createdAt" ASC
          LIMIT ${BATCH_SIZE}
          FOR UPDATE SKIP LOCKED
        `);
        if (claimed.length === 0) return 0;

        const sent: string[] = [];
        const retry: string[] = [];
        const failed: string[] = [];

        for (const event of claimed) {
          try {
            await this.publish(event);
            sent.push(event.id);
          } catch (err) {
            this.logger.warn(`outbox emit failed for ${event.id}: ${this.describe(err)}`);
            if (event.attempts + 1 >= MAX_ATTEMPTS) failed.push(event.id);
            else retry.push(event.id);
          }
        }

        if (sent.length > 0) {
          await tx.outboxEvent.updateMany({
            where: { id: { in: sent } },
            data: { status: "SENT", sentAt: new Date() },
          });
        }
        if (retry.length > 0) {
          await tx.outboxEvent.updateMany({
            where: { id: { in: retry } },
            data: { attempts: { increment: 1 } },
          });
        }
        if (failed.length > 0) {
          await tx.outboxEvent.updateMany({
            where: { id: { in: failed } },
            data: { status: "FAILED", attempts: { increment: 1 } },
          });
        }
        return claimed.length;
      },
      { timeout: TX_TIMEOUT_MS },
    );
  }

  private async publish(event: ClaimedEvent): Promise<void> {
    if (event.rooms.length === 0) return; // nothing to deliver to
    const message = JSON.stringify({
      rooms: event.rooms,
      event: event.type,
      payload: event.payload,
    });
    await this.redis.client.publish(REALTIME_RELAY_CHANNEL, message);
  }

  private describe(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
  }
}
