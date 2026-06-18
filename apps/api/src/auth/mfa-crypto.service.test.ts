import { describe, expect, it } from "vitest";
import { type Env } from "@aureus/shared";
import { MfaCryptoService } from "./mfa-crypto.service";

const svc = new MfaCryptoService({ JWT_REFRESH_SECRET: "x".repeat(40) } as Env);

describe("MfaCryptoService", () => {
  it("round-trips a TOTP secret and never stores plaintext", () => {
    const secret = "JBSWY3DPEHPK3PXP";
    const enc = svc.encrypt(secret);
    expect(enc.startsWith("gcm:")).toBe(true);
    expect(enc).not.toContain(secret);
    expect(svc.decrypt(enc)).toBe(secret);
  });

  it("produces a fresh ciphertext each time (random IV)", () => {
    expect(svc.encrypt("ABC")).not.toBe(svc.encrypt("ABC"));
  });

  it("tolerates legacy plaintext (no gcm: prefix)", () => {
    expect(svc.decrypt("JBSWY3DPEHPK3PXP")).toBe("JBSWY3DPEHPK3PXP");
  });
});
