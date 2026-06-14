import { type INestApplicationContext } from "@nestjs/common";
import { IoAdapter } from "@nestjs/platform-socket.io";
import { createAdapter } from "@socket.io/redis-adapter";
import Redis from "ioredis";
import { type Server, type ServerOptions } from "socket.io";
import { type Env } from "@aureus/shared";
import { ENV } from "../config/config.module";

/**
 * Socket.io Redis adapter (docs/01 §5). Attaching it lets in-process emits on
 * any web node reach clients connected to every other node. Call
 * `connectToRedis()` once after the Nest app is created and before `listen`,
 * then `app.useWebSocketAdapter(adapter)`. When SOCKET_ADAPTER=memory the
 * adapter is a no-op and Socket.io uses its default single-node adapter.
 */
export class RedisIoAdapter extends IoAdapter {
  private adapterConstructor?: ReturnType<typeof createAdapter>;
  private pubClient?: Redis;
  private subClient?: Redis;
  private readonly env: Env;

  constructor(app: INestApplicationContext) {
    super(app);
    this.env = app.get<Env>(ENV);
  }

  async connectToRedis(): Promise<void> {
    if (this.env.SOCKET_ADAPTER !== "redis") return;
    this.pubClient = new Redis(this.env.REDIS_URL, {
      maxRetriesPerRequest: null,
      lazyConnect: true,
    });
    this.subClient = this.pubClient.duplicate();
    await Promise.all([this.pubClient.connect(), this.subClient.connect()]);
    this.adapterConstructor = createAdapter(this.pubClient, this.subClient);
  }

  override createIOServer(port: number, options?: ServerOptions): Server {
    const server: Server = super.createIOServer(port, options) as Server;
    if (this.adapterConstructor) server.adapter(this.adapterConstructor);
    return server;
  }
}
