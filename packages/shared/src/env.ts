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
  // SECRETS: NO default — every entrypoint must declare NODE_ENV explicitly (.env /
  // .env.example set "development", the Docker image sets "production", vitest sets
  // "test"). A missing value fails fast rather than silently treating a real prod
  // process as dev (which would disable the production-only guards below).
  NODE_ENV: z.enum(["development", "test", "production"]),
  PLATFORM_MODE: platformModeSchema.default("OPERATOR"),

  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),

  // auth — require ≥32 chars (256-bit) secrets; prod uses 64-char values (VAL).
  JWT_ACCESS_SECRET: z.string().min(32),
  JWT_REFRESH_SECRET: z.string().min(32),
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
  // INFRA-1: number of trusted proxy hops in front of the API (Railway = 1). Drives
  // Express `trust proxy` so req.ip is the real client IP (per-IP throttle + audit
  // forensics). Must match the real topology EXACTLY — OVER-counting lets a client
  // spoof X-Forwarded-For (re-opening INFRA-1), so it is capped. 0 disables trust
  // (safe default for an un-proxied / direct-exposed bind).
  TRUST_PROXY_HOPS: z.coerce.number().int().nonnegative().max(8).default(1),
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
  // Master on/off switch for geo enforcement, DEFAULT "off" (safe-by-default). Geo
  // region rules are only applied when this is "on" AND the platform GEO_ENFORCED
  // setting is on AND GEO_EDGE_HEADER_SECRET is configured. Defaulting off means a
  // deploy can never silently lock players out behind a forgeable/absent geo header;
  // flip to "on" only once the trusted edge + secret are in place.
  GEO_ENFORCEMENT: z.enum(["on", "off"]).default("off"),
  // GEO-1: shared secret the trusted CDN/edge injects as `x-edge-proof`. It is the
  // MASTER SWITCH for geo enforcement (compliance.service only enforces region rules
  // when this is set) and drives the strip-untrusted-geo middleware (which drops
  // client-supplied CF-IPCountry/X-Vercel-IP-Country unless the matching proof is
  // present). OPTIONAL and safe-by-default: unset => geo is advisory/off and nothing
  // can lock players out; set it (and configure the edge to inject the same value as
  // x-edge-proof) to turn on forgery-proof geo blocking. No infra dependency to boot.
  GEO_EDGE_HEADER_SECRET: z.string().optional(),
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
})
  // SECRETS-2 / SECRETS-3: in production, real R2 storage is MANDATORY. Never fall
  // back to the in-memory stub client (it would silently drop KYC PII uploads) and
  // never run with an empty bucket name. Dev/test may omit R2_* and use the stub.
  // (Operational: production R2 creds must come from the platform secret store, be
  // bucket-scoped/least-privilege, and never live in a working-tree .env.)
  .superRefine((val, ctx) => {
    if (val.NODE_ENV !== "production") return;
    const add = (path: string, message: string) =>
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: [path], message });
    if (!val.R2_ACCOUNT_ID?.trim()) add("R2_ACCOUNT_ID", "required in production (no stub storage)");
    if (!val.R2_ACCESS_KEY_ID?.trim()) add("R2_ACCESS_KEY_ID", "required in production (no stub storage)");
    if (!val.R2_SECRET_ACCESS_KEY?.trim()) add("R2_SECRET_ACCESS_KEY", "required in production (no stub storage)");
    if (!val.R2_BUCKET_ASSETS.trim()) add("R2_BUCKET_ASSETS", "must be a non-empty bucket in production");
    if (!val.R2_BUCKET_KYC.trim()) add("R2_BUCKET_KYC", "must be a non-empty bucket in production");
    // KYC PII must never share the (public) assets bucket — keep them distinct.
    if (val.R2_BUCKET_KYC.trim() === val.R2_BUCKET_ASSETS.trim()) {
      add("R2_BUCKET_KYC", "must differ from R2_BUCKET_ASSETS (KYC PII must not share the public assets bucket)");
    }
    // GEO_EDGE_HEADER_SECRET is intentionally NOT required: it is the opt-in master
    // switch for geo enforcement (see its declaration). Leaving it unset is the safe
    // default (geo advisory/off), so production boots without an edge dependency.
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
