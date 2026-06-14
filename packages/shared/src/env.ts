import { z } from "zod";

/**
 * Backend environment schema (api web + worker + db seed). Validated once at
 * boot; the process fails fast if anything required is missing or malformed
 * (docs/01 §10). Frontend (NEXT_PUBLIC_*) vars are validated in the apps.
 */

const csv = z
  .string()
  .transform((s) => s.split(",").map((v) => v.trim()).filter(Boolean));

const port = z.coerce.number().int().positive().max(65535);

export const platformModeSchema = z.enum(["OPERATOR", "COMPLIANCE"]);
export type PlatformMode = z.infer<typeof platformModeSchema>;

export const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PLATFORM_MODE: platformModeSchema.default("OPERATOR"),

  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),

  // auth
  JWT_ACCESS_SECRET: z.string().min(16),
  JWT_REFRESH_SECRET: z.string().min(16),
  JWT_ACCESS_TTL: z.coerce.number().int().positive().default(900),
  JWT_REFRESH_TTL: z.coerce.number().int().positive().default(2_592_000),
  JWT_KID: z.string().default("key-1"),
  COOKIE_DOMAIN: z.string().default("localhost"),
  COOKIE_SECURE: z
    .string()
    .transform((v) => v === "true")
    .default("false"),
  // Cross-site auth (frontends on Vercel, API on Railway, different registrable
  // domains) needs "none"; a same-domain setup (api/app/console all under
  // goldwavecasino.xyz) can stay "lax". "none" implies Secure.
  COOKIE_SAMESITE: z.enum(["lax", "strict", "none"]).default("lax"),
  ARGON2_MEMORY_KIB: z.coerce.number().int().positive().default(19_456),

  // urls / cors
  API_URL: z.string().url().default("http://localhost:4000"),
  API_PORT: port.default(4000),
  CONSOLE_URL: z.string().url().default("http://localhost:3000"),
  ARCADE_URL: z.string().url().default("http://localhost:3001"),
  ALLOWED_ORIGINS: csv.default("http://localhost:3000,http://localhost:3001"),

  // money
  CREDIT_MINOR_UNITS: z.coerce.number().int().positive().default(1000),
  DEFAULT_GAME_RTP_BPS: z.coerce.number().int().min(1).max(10_000).default(9400),

  // storage (R2) — optional in dev (stub client)
  R2_ACCOUNT_ID: z.string().optional(),
  R2_ACCESS_KEY_ID: z.string().optional(),
  R2_SECRET_ACCESS_KEY: z.string().optional(),
  R2_BUCKET_ASSETS: z.string().default("aureus-assets"),
  R2_BUCKET_KYC: z.string().default("aureus-kyc"),

  // compliance
  KYC_PROVIDER: z.string().default("stub"),
  GEO_PROVIDER: z.string().default("stub"),
  AML_ENABLED: z
    .string()
    .transform((v) => v !== "false")
    .default("true"),
  SELF_EXCLUSION_ENABLED: z
    .string()
    .transform((v) => v !== "false")
    .default("true"),
  REDEMPTION_KYC_THRESHOLD_MINOR: z.coerce.number().int().nonnegative().default(50_000),

  // realtime / workers
  SOCKET_ADAPTER: z.enum(["redis", "memory"]).default("redis"),
  OUTBOX_RELAY_INTERVAL_MS: z.coerce.number().int().positive().default(1000),
});

export type Env = z.infer<typeof envSchema>;

/**
 * Parse and validate process.env. Throws a readable aggregated error on
 * failure. Call once at process start; pass the result around (no hidden
 * globals).
 */
export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("\n");
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  return parsed.data;
}
