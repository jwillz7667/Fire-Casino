import { describe, expect, it } from "vitest";
import { presignR2Url } from "./r2-presigner";

const creds = { accountId: "acct123", accessKeyId: "AKIAEXAMPLE", secretAccessKey: "secret" };
const now = new Date("2026-06-18T00:00:00.000Z");

describe("presignR2Url — AWS SigV4 for R2", () => {
  it("produces a well-formed presigned PUT URL", () => {
    const url = presignR2Url({
      creds,
      method: "PUT",
      bucket: "aureus-kyc",
      key: "kyc/op/doc.png",
      expiresSeconds: 300,
      now,
    });
    expect(url.startsWith("https://acct123.r2.cloudflarestorage.com/aureus-kyc/kyc/op/doc.png?")).toBe(true);
    expect(url).toContain("X-Amz-Algorithm=AWS4-HMAC-SHA256");
    expect(url).toContain("X-Amz-Credential=AKIAEXAMPLE%2F20260618%2Fauto%2Fs3%2Faws4_request");
    expect(url).toContain("X-Amz-Date=20260618T000000Z");
    expect(url).toContain("X-Amz-Expires=300");
    expect(url).toContain("X-Amz-SignedHeaders=host");
    expect(url).toMatch(/X-Amz-Signature=[0-9a-f]{64}$/);
  });

  it("is deterministic for identical inputs and varies by key", () => {
    const base = { creds, method: "GET" as const, bucket: "b", expiresSeconds: 60, now };
    expect(presignR2Url({ ...base, key: "k" })).toBe(presignR2Url({ ...base, key: "k" }));
    expect(presignR2Url({ ...base, key: "k1" })).not.toBe(presignR2Url({ ...base, key: "k2" }));
  });
});
