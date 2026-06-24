import "@aureus/shared/bigint";

import { NestFactory } from "@nestjs/core";
import cookieParser from "cookie-parser";
import { Logger } from "nestjs-pino";
import { loadEnv } from "@aureus/shared";
import { loadDotenv } from "@aureus/shared/dotenv";
import { AppModule } from "./app.module";
import { RedisIoAdapter } from "./realtime/redis-io.adapter";
import { securityHeaders } from "./common/http/security-headers";
import { stripUntrustedGeoHeaders } from "./common/http/strip-untrusted-geo";

async function bootstrap(): Promise<void> {
  loadDotenv();
  const env = loadEnv();
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  const logger = app.get(Logger);
  app.useLogger(logger);

  // INFRA-1: behind Railway's proxy, trust exactly TRUST_PROXY_HOPS hop(s) so
  // req.ip resolves to the real client IP — restoring per-IP rate-limit buckets and
  // truthful audit/AML IPs. Pin the count: NEVER use trust-all ('true'), or a client
  // could spoof X-Forwarded-For to evade throttling and poison the audit trail.
  if (env.TRUST_PROXY_HOPS > 0) {
    app.getHttpAdapter().getInstance().set("trust proxy", env.TRUST_PROXY_HOPS);
  }

  // Versioned REST surface; health probes stay at the root for load balancers.
  app.setGlobalPrefix("api/v1", { exclude: ["healthz", "readyz"] });

  app.use(securityHeaders);
  app.use(cookieParser());
  // GEO-1: drop client-forged CF-IPCountry/X-Vercel-IP-Country unless the request
  // carries the edge's x-edge-proof secret (no-op when GEO_EDGE_HEADER_SECRET unset).
  app.use(stripUntrustedGeoHeaders(env.GEO_EDGE_HEADER_SECRET));

  app.enableCors({
    origin: env.ALLOWED_ORIGINS,
    credentials: true,
  });

  app.enableShutdownHooks();

  // Socket.io realtime (docs/05 §11). The Redis adapter lets balance/order/
  // redemption events relayed from the worker reach clients across web instances;
  // it no-ops to the single-node adapter when SOCKET_ADAPTER !== "redis".
  const wsAdapter = new RedisIoAdapter(app);
  await wsAdapter.connectToRedis();
  app.useWebSocketAdapter(wsAdapter);

  // Railway (and most PaaS) inject the bound port via PORT; fall back to API_PORT.
  const port = process.env.PORT ? Number(process.env.PORT) : env.API_PORT;
  await app.listen(port);
  logger.log(`api (web) listening on :${String(port)} [mode=${env.PLATFORM_MODE}]`, "Bootstrap");
}

void bootstrap();
