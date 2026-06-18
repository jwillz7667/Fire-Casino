import { Inject, Logger, type OnModuleDestroy } from "@nestjs/common";
import {
  ConnectedSocket,
  MessageBody,
  type OnGatewayConnection,
  type OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from "@nestjs/websockets";
import Redis from "ioredis";
import { type Server, type Socket } from "socket.io";
import { type PrismaClient } from "@aureus/db";
import { type Env, isInSubtree, subscribeSchema } from "@aureus/shared";
import { ENV } from "../config/config.module";
import { PRISMA_SYSTEM } from "../prisma/prisma.module";
import { type Principal } from "../common/auth/principal";
import { RealtimeService } from "./realtime.service";
import {
  allowedRoomsFor,
  canJoinRoom,
  REALTIME_RELAY_CHANNEL,
  relayMessageSchema,
} from "./room-access";

/**
 * The decorator is evaluated at import time, before DI exists, so CORS origins
 * are read from process.env (dotenv is loaded in main.ts before module import).
 * This mirrors the parsing of ALLOWED_ORIGINS in the env schema.
 */
function corsOrigins(): string[] {
  const raw = process.env.ALLOWED_ORIGINS;
  if (!raw) return ["http://localhost:3000", "http://localhost:3001"];
  return raw
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);
}

/** The principal we attach to each authenticated socket (socket.io types data as any). */
interface SocketData {
  principal?: Principal;
  rateWindowStart?: number;
  msgCount?: number;
}

// Per-socket message flood control (R2): a single connection can't drive unbounded
// subscribe work (each subscribe does up to 50 DB lookups). In-memory per-connection.
const SOCKET_MSG_WINDOW_MS = 10_000;
const SOCKET_MSG_MAX = 30;

/**
 * Socket.io gateway (docs/05 §11). Authenticates the handshake token, auto-joins
 * the principal's own rooms, and gates every explicit subscribe against the
 * room-access rules (player → own room; operator → own + descendant operator
 * rooms via a DB subtree check; admin tiers → admin:global). Server→client
 * payloads originate only from outbox events relayed over Redis — never from the
 * client. A per-node Redis subscriber bridges the worker relay to local sockets.
 */
@WebSocketGateway({ cors: { origin: corsOrigins(), credentials: true } })
export class RealtimeGateway
  implements OnGatewayConnection, OnGatewayInit, OnModuleDestroy
{
  private readonly logger = new Logger(RealtimeGateway.name);

  @WebSocketServer()
  private server?: Server;

  private subscriber?: Redis;

  constructor(
    @Inject(ENV) private readonly env: Env,
    @Inject(PRISMA_SYSTEM) private readonly system: PrismaClient,
    private readonly realtime: RealtimeService,
  ) {}

  afterInit(): void {
    // Dedicated connection: once subscribed an ioredis client cannot issue other
    // commands, so this must not be the shared RedisService client.
    const subscriber = new Redis(this.env.REDIS_URL, { maxRetriesPerRequest: null });
    subscriber.on("message", (_channel, message) => this.relayToLocal(message));
    subscriber.on("error", (err) =>
      this.logger.warn(`realtime relay subscriber error: ${err.message}`),
    );
    // The realtime relay is a best-effort enhancement: a failed subscribe (Redis
    // down, ACL, transient) must never crash the web process — clients refetch on
    // reconnect, so degrade to no live push rather than take down HTTP.
    subscriber.subscribe(REALTIME_RELAY_CHANNEL).catch((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(`realtime relay subscribe failed: ${message}`);
    });
    this.subscriber = subscriber;
  }

  async handleConnection(client: Socket): Promise<void> {
    const token = this.extractToken(client);
    if (!token) {
      client.disconnect(true);
      return;
    }
    let principal: Principal;
    try {
      principal = await this.realtime.loadPrincipalFromToken(token);
    } catch {
      client.disconnect(true);
      return;
    }
    (client.data as SocketData).principal = principal;
    for (const room of allowedRoomsFor(principal)) {
      await client.join(room);
    }
  }

  @SubscribeMessage("subscribe")
  async subscribe(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: unknown,
  ): Promise<{ joined: string[] }> {
    const principal = this.principalOf(client);
    if (!principal) {
      client.disconnect(true);
      return { joined: [] };
    }
    if (!this.allowMessage(client)) {
      client.emit("error", { code: "RATE_LIMITED" });
      return { joined: [] };
    }
    const parsed = subscribeSchema.safeParse(body);
    if (!parsed.success) return { joined: [] };

    const joined: string[] = [];
    for (const room of parsed.data.rooms) {
      if (await this.mayJoin(principal, room)) {
        await client.join(room);
        joined.push(room);
      }
    }
    return { joined };
  }

  @SubscribeMessage("unsubscribe")
  async unsubscribe(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: unknown,
  ): Promise<{ left: string[] }> {
    if (!this.allowMessage(client)) return { left: [] };
    const parsed = subscribeSchema.safeParse(body);
    if (!parsed.success) return { left: [] };
    const left: string[] = [];
    for (const room of parsed.data.rooms) {
      await client.leave(room);
      left.push(room);
    }
    return { left };
  }

  /** In-process emit (cluster-wide via the Redis adapter) for web-side callers. */
  emit(rooms: string[], event: string, payload: unknown): void {
    if (rooms.length === 0) return;
    this.server?.to(rooms).emit(event, payload);
  }

  async onModuleDestroy(): Promise<void> {
    if (!this.subscriber) return;
    try {
      await this.subscriber.quit();
    } catch {
      this.subscriber.disconnect();
    }
  }

  private principalOf(client: Socket): Principal | undefined {
    return (client.data as SocketData).principal;
  }

  /** Per-socket sliding-window flood control for inbound messages (R2). */
  private allowMessage(client: Socket): boolean {
    const data = client.data as SocketData;
    const now = Date.now();
    if (data.rateWindowStart === undefined || now - data.rateWindowStart > SOCKET_MSG_WINDOW_MS) {
      data.rateWindowStart = now;
      data.msgCount = 0;
    }
    data.msgCount = (data.msgCount ?? 0) + 1;
    return data.msgCount <= SOCKET_MSG_MAX;
  }

  private async mayJoin(principal: Principal, room: string): Promise<boolean> {
    const decision = canJoinRoom(principal, room);
    if (decision.kind === "allow") return true;
    if (decision.kind === "deny") return false;
    // check-operator: only an operator principal reaches here.
    if (principal.kind !== "operator") return false;
    const target = await this.system.operator.findUnique({
      where: { id: decision.operatorId },
      select: { path: true },
    });
    if (!target) return false;
    return isInSubtree(principal.path, target.path);
  }

  private extractToken(client: Socket): string | null {
    const auth: { token?: unknown } = client.handshake.auth;
    if (typeof auth.token === "string" && auth.token.length > 0) return auth.token;
    const header = client.handshake.headers.authorization;
    if (typeof header === "string" && header.startsWith("Bearer ")) {
      return header.slice("Bearer ".length).trim();
    }
    return null;
  }

  private relayToLocal(raw: string): void {
    let data: unknown;
    try {
      data = JSON.parse(raw);
    } catch {
      return;
    }
    const parsed = relayMessageSchema.safeParse(data);
    if (!parsed.success) return;
    // `.local` restricts delivery to sockets on THIS node, so each web node can
    // independently consume the broadcast without the adapter re-fanning it out.
    this.server?.local.to(parsed.data.rooms).emit(parsed.data.event, parsed.data.payload);
  }
}
