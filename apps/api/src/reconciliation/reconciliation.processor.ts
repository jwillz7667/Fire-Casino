import { Inject, Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import { type ConnectionOptions, type Job, Queue, Worker } from "bullmq";
import { type Env } from "@aureus/shared";
import { ENV } from "../config/config.module";
import { RedisService } from "../redis/redis.service";
import { ReconciliationService, type ReconResult } from "./reconciliation.service";

/**
 * Build BullMQ connection options from REDIS_URL. Passing plain options (rather
 * than a shared ioredis instance) lets BullMQ create its own client with its
 * bundled ioredis, avoiding a cross-version type clash, and BullMQ requires
 * `maxRetriesPerRequest: null` on its blocking connections.
 */
function bullConnection(redisUrl: string): ConnectionOptions {
  const u = new URL(redisUrl);
  return {
    host: u.hostname,
    port: u.port ? Number(u.port) : 6379,
    username: u.username || undefined,
    password: u.password || undefined,
    db: u.pathname && u.pathname.length > 1 ? Number(u.pathname.slice(1)) : undefined,
    maxRetriesPerRequest: null,
  };
}

const QUEUE_NAME = "reconciliation";
const JOB_NAME = "runAll";
const INTERVAL_MS = 5 * 60_000; // run the integrity sweep every five minutes
/** Key the latest reconciliation result lands on for the Ledger Health page. */
export const RECON_LAST_KEY = "recon:last";

/**
 * Scheduled ledger-integrity worker (docs/03 §7-8, docs/09 Phase 13). On boot it
 * registers a repeatable BullMQ job and a worker that runs every reconciliation
 * check, caches the result JSON in Redis, and logs a warning on any failed check
 * so drift surfaces immediately. The queue/worker each get their own ioredis
 * connection (BullMQ requires `maxRetriesPerRequest: null` and the worker blocks).
 */
@Injectable()
export class ReconciliationProcessor implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ReconciliationProcessor.name);
  private queue?: Queue;
  private worker?: Worker;

  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly redis: RedisService,
    private readonly reconciliation: ReconciliationService,
  ) {}

  async onModuleInit(): Promise<void> {
    const connection = bullConnection(this.env.REDIS_URL);
    this.queue = new Queue(QUEUE_NAME, { connection });
    this.worker = new Worker(QUEUE_NAME, (job) => this.handle(job), { connection });
    this.worker.on("failed", (job, err) => {
      this.logger.error(`reconciliation job ${job?.id ?? "?"} failed: ${err.message}`);
    });

    // Idempotent: re-adding the same repeatable key just keeps one schedule.
    await this.queue.add(
      JOB_NAME,
      {},
      { repeat: { every: INTERVAL_MS }, jobId: JOB_NAME, removeOnComplete: true, removeOnFail: 100 },
    );
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close();
    await this.queue?.close();
  }

  private async handle(_job: Job): Promise<ReconResult> {
    const result = await this.reconciliation.runAll();
    await this.redis.client.set(RECON_LAST_KEY, JSON.stringify(result));
    const failed = result.checks.filter((c) => !c.ok);
    if (failed.length > 0) {
      this.logger.warn(
        `ledger reconciliation flagged ${failed.length.toString()} check(s): ${failed.map((c) => `${c.name} (${c.detail})`).join("; ")}`,
      );
    }
    return result;
  }
}
