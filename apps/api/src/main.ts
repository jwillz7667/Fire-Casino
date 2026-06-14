import "@aureus/shared/bigint";

import { NestFactory } from "@nestjs/core";
import cookieParser from "cookie-parser";
import { Logger } from "nestjs-pino";
import { loadDotenv, loadEnv } from "@aureus/shared";
import { AppModule } from "./app.module";

async function bootstrap(): Promise<void> {
  loadDotenv();
  const env = loadEnv();
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  const logger = app.get(Logger);
  app.useLogger(logger);

  // Versioned REST surface; health probes stay at the root for load balancers.
  app.setGlobalPrefix("api/v1", { exclude: ["healthz", "readyz"] });

  app.use(cookieParser());

  app.enableCors({
    origin: env.ALLOWED_ORIGINS,
    credentials: true,
  });

  app.enableShutdownHooks();

  await app.listen(env.API_PORT);
  logger.log(`api (web) listening on :${String(env.API_PORT)} [mode=${env.PLATFORM_MODE}]`, "Bootstrap");
}

void bootstrap();
