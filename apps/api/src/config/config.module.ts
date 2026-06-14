import { Global, Module } from "@nestjs/common";
import { loadEnv, type Env } from "@aureus/shared";

/** DI token for the validated, typed environment config. */
export const ENV = Symbol("ENV");

/**
 * Loads and validates process.env once at boot (fail-fast). Provided globally
 * so any provider can `@Inject(ENV) private readonly env: Env`.
 */
@Global()
@Module({
  providers: [{ provide: ENV, useFactory: (): Env => loadEnv() }],
  exports: [ENV],
})
export class ConfigModule {}
