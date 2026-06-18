import "@aureus/shared/bigint";

import { NestFactory } from "@nestjs/core";
import cookieParser from "cookie-parser";
import { Logger } from "nestjs-pino";
import { loadEnv } from "@aureus/shared";
import { loadDotenv } from "@aureus/shared/dotenv";
import { AppModule } from "./app.module";
import { RedisIoAdapter } from "./realtime/redis-io.adapter";
import { securityHeaders } from "./common/http/security-headers";

async function bootstrap(): Promise<void> {
  loadDotenv();
  const env = loadEnv();
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  const logger = app.get(Logger);
  app.useLogger(logger);

  // Versioned REST surface; health probes stay at the root for load balancers.
  app.setGlobalPrefix("api/v1", { exclude: ["healthz", "readyz"] });

  app.use(securityHeaders);
  app.use(cookieParser());

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
