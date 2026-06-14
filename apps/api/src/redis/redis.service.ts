import { Inject, Injectable, type OnModuleDestroy } from "@nestjs/common";
import Redis from "ioredis";
import { type Env } from "@aureus/shared";
import { ENV } from "../config/config.module";

/**
 * Shared ioredis connection. `maxRetriesPerRequest: null` keeps the connection
 * compatible with BullMQ (wired in later phases). `lazyConnect` defers the TCP
 * connection until first use so boot doesn't fail if Redis is briefly down.
 */
@Injectable()
export class RedisService implements OnModuleDestroy {
  readonly client: Redis;

  constructor(@Inject(ENV) env: Env) {
    this.client = new Redis(env.REDIS_URL, {
      maxRetriesPerRequest: null,
      lazyConnect: true,
    });
  }

  async ping(): Promise<boolean> {
    const res = await this.client.ping();
    return res === "PONG";
  }

  async onModuleDestroy(): Promise<void> {
    try {
      await this.client.quit();
    } catch {
      this.client.disconnect();
    }
  }
}
