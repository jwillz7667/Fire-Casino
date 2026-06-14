import "@aureus/shared/bigint";

import { Logger } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { loadDotenv, loadEnv } from "@aureus/shared";
import { AppModule } from "./app.module";

async function bootstrap(): Promise<void> {
  loadDotenv();
  const env = loadEnv();
  const app = await NestFactory.create(AppModule, { bufferLogs: false });

  // Versioned REST surface; health probes stay at the root for load balancers.
  app.setGlobalPrefix("api/v1", { exclude: ["healthz", "readyz"] });

  app.enableCors({
    origin: env.ALLOWED_ORIGINS,
    credentials: true,
  });

  app.enableShutdownHooks();

  await app.listen(env.API_PORT);
  Logger.log(`api (web) listening on :${String(env.API_PORT)} [mode=${env.PLATFORM_MODE}]`, "Bootstrap");
}

void bootstrap();
