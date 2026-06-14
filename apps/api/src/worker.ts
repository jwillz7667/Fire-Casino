import "@aureus/shared/bigint";

import { NestFactory } from "@nestjs/core";
import { Logger } from "nestjs-pino";
import { loadEnv } from "@aureus/shared";
import { loadDotenv } from "@aureus/shared/dotenv";
import { WorkerModule } from "./worker.module";

async function bootstrap(): Promise<void> {
  loadDotenv();
  const env = loadEnv();
  const app = await NestFactory.createApplicationContext(WorkerModule, {
    bufferLogs: true,
  });
  const logger = app.get(Logger);
  app.useLogger(logger);
  app.enableShutdownHooks();

  logger.log(`api (worker) started [mode=${env.PLATFORM_MODE}]`, "Worker");
}

void bootstrap();
