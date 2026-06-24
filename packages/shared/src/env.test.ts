import { describe, expect, it } from "vitest";
import { loadEnv } from "./env";

/** Minimal valid backend env (no R2 — allowed outside production). */
const base = {
  NODE_ENV: "development",
  DATABASE_URL: "postgres://u:p@localhost:5432/db",
  REDIS_URL: "redis://localhost:6379",
  JWT_ACCESS_SECRET: "a".repeat(32),
  JWT_REFRESH_SECRET: "b".repeat(32),
} satisfies NodeJS.ProcessEnv;

/** The extra vars production requires (R2 storage + the geo edge-proof secret). */
const prodCreds = {
  R2_ACCOUNT_ID: "acct",
  R2_ACCESS_KEY_ID: "key",
  R2_SECRET_ACCESS_KEY: "secret",
  GEO_EDGE_HEADER_SECRET: "edge-proof-secret",
} satisfies NodeJS.ProcessEnv;

describe("env schema", () => {
  it("requires NODE_ENV with no default (SECRETS — no silent dev fallback)", () => {
    const { NODE_ENV: _omit, ...noEnv } = base;
    expect(() => loadEnv(noEnv)).toThrow(/NODE_ENV/i);
  });

  it("defaults TRUST_PROXY_HOPS to 1 (INFRA-1)", () => {
    expect(loadEnv({ ...base }).TRUST_PROXY_HOPS).toBe(1);
  });

  it("coerces an explicit TRUST_PROXY_HOPS and caps it", () => {
    expect(loadEnv({ ...base, TRUST_PROXY_HOPS: "2" }).TRUST_PROXY_HOPS).toBe(2);
    expect(() => loadEnv({ ...base, TRUST_PROXY_HOPS: "99" })).toThrow();
  });

  it("rejects KYC bucket equal to the public assets bucket in production (SECRETS)", () => {
    expect(() =>
      loadEnv({
        ...base,
        ...prodCreds,
        NODE_ENV: "production",
        R2_BUCKET_ASSETS: "shared-bucket",
        R2_BUCKET_KYC: "shared-bucket",
      }),
    ).toThrow(/differ|R2_BUCKET_KYC/);
  });

  it("allows missing R2 credentials outside production (dev stub storage)", () => {
    expect(() => loadEnv({ ...base, NODE_ENV: "development" })).not.toThrow();
    expect(() => loadEnv({ ...base, NODE_ENV: "test" })).not.toThrow();
  });

  it("requires R2 credentials in production — fails fast otherwise (SECRETS-2/3)", () => {
    expect(() => loadEnv({ ...base, NODE_ENV: "production" })).toThrow(
      /R2_ACCOUNT_ID|R2_ACCESS_KEY_ID|R2_SECRET_ACCESS_KEY/,
    );
  });

  it("requires GEO_EDGE_HEADER_SECRET in production (GEO-1 forgery guard)", () => {
    const { GEO_EDGE_HEADER_SECRET: _drop, ...credsNoGeo } = prodCreds;
    expect(() => loadEnv({ ...base, ...credsNoGeo, NODE_ENV: "production" })).toThrow(
      /GEO_EDGE_HEADER_SECRET/,
    );
  });

  it("accepts production once all required prod vars are present", () => {
    const env = loadEnv({ ...base, ...prodCreds, NODE_ENV: "production" });
    expect(env.NODE_ENV).toBe("production");
    expect(env.R2_BUCKET_KYC.length).toBeGreaterThan(0);
    expect(env.GEO_EDGE_HEADER_SECRET).toBe("edge-proof-secret");
  });
});
