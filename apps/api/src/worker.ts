import "@aureus/shared/bigint";

import { Logger } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { loadDotenv, loadEnv } from "@aureus/shared";
import { WorkerModule } from "./worker.module";

async function bootstrap(): Promise<void> {
  loadDotenv();
  const env = loadEnv();
  const app = await NestFactory.createApplicationContext(WorkerModule, {
    bufferLogs: false,
  });
  app.enableShutdownHooks();

  Logger.log(`api (worker) started [mode=${env.PLATFORM_MODE}]`, "Worker");
}

void bootstrap();
