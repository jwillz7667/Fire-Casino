import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from "@nestjs/common";
import { type Job, Queue, Worker } from "bullmq";
import { type Env } from "@aureus/shared";
import { ENV } from "../config/config.module";
import { RedisService } from "../redis/redis.service";
import { bullConnection } from "../redis/bull-connection";
import { ReconciliationService, type ReconResult } from "./reconciliation.service";

const QUEUE_NAME = "reconciliation";
const JOB_NAME = "runAll";
const INTERVAL_MS = 5 * 60_000; // run the integrity sweep every five minutes
const SCHEDULE_REFRESH_MS = 60_000;
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
  private scheduleTimer?: ReturnType<typeof setInterval>;
  private registering?: Promise<void>;

  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly redis: RedisService,
    private readonly reconciliation: ReconciliationService,
  ) {}

  async onModuleInit(): Promise<void> {
    const connection = bullConnection(this.env.REDIS_URL);
    this.queue = new Queue(QUEUE_NAME, { connection });
    this.worker = new Worker(QUEUE_NAME, (job) => this.handle(job), { connection });
    this.queue.on("error", (err: Error) =>
      this.logger.error(`reconciliation queue error: ${err.message}`),
    );
    this.worker.on("error", (err: Error) =>
      this.logger.error(`reconciliation worker error: ${err.message}`),
    );
    this.worker.on("failed", (job, err) => {
      this.logger.error(`reconciliation job ${job?.id ?? "?"} failed: ${err.message}`);
    });

    // Free Redis instances can restart with an empty dataset while this process
    // stays alive. Re-register periodically so losing the repeat key cannot
    // silently disable ledger checks until the next application deployment.
    this.scheduleTimer = setInterval(() => {
      void this.ensureSchedule().catch((err: unknown) => {
        this.logger.error(
          `reconciliation schedule refresh failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      });
    }, SCHEDULE_REFRESH_MS);
    this.scheduleTimer.unref();
    await this.ensureSchedule();
  }

  async onModuleDestroy(): Promise<void> {
    if (this.scheduleTimer) clearInterval(this.scheduleTimer);
    await this.worker?.close();
    await this.queue?.close();
  }

  private ensureSchedule(): Promise<void> {
    if (this.registering) return this.registering;
    if (!this.queue) return Promise.resolve();
    // Idempotent: re-adding the same repeatable key just keeps one schedule.
    this.registering = this.queue
      .add(
        JOB_NAME,
        {},
        {
          repeat: { every: INTERVAL_MS },
          jobId: JOB_NAME,
          removeOnComplete: true,
          removeOnFail: 100,
        },
      )
      .then(() => undefined)
      .finally(() => {
        this.registering = undefined;
      });
    return this.registering;
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
