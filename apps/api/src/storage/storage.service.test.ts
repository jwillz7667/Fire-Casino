import { describe, expect, it } from "vitest";
import { StorageService } from "./storage.service";

// Minimal Env subset the service reads. No R2 creds → stub host; with creds → R2 host.
function service(withCreds: boolean): StorageService {
  const env = {
    R2_BUCKET_KYC: "aureus-kyc",
    R2_BUCKET_ASSETS: "aureus-assets",
    ...(withCreds
      ? { R2_ACCOUNT_ID: "acct123", R2_ACCESS_KEY_ID: "AKIA", R2_SECRET_ACCESS_KEY: "secret" }
      : {}),
  } as unknown as ConstructorParameters<typeof StorageService>[0];
  return new StorageService(env);
}

describe("StorageService.keyFromFileUrl — only presign objects we own", () => {
  it("recovers the key from a stub URL in the named bucket", () => {
    const svc = service(false);
    const key = svc.keyFromFileUrl("kyc", "https://r2.stub.local/aureus-kyc/players/p1/abc-doc.png");
    expect(key).toBe("players/p1/abc-doc.png");
  });

  it("recovers the key from a real R2 host URL", () => {
    const svc = service(true);
    const key = svc.keyFromFileUrl(
      "kyc",
      "https://acct123.r2.cloudflarestorage.com/aureus-kyc/players/p1/abc-doc.png",
    );
    expect(key).toBe("players/p1/abc-doc.png");
  });

  it("rejects a foreign host", () => {
    const svc = service(true);
    expect(svc.keyFromFileUrl("kyc", "https://evil.com/aureus-kyc/players/p1/x.png")).toBeNull();
  });

  it("rejects a URL pointed at a different bucket", () => {
    const svc = service(true);
    expect(
      svc.keyFromFileUrl("kyc", "https://acct123.r2.cloudflarestorage.com/aureus-assets/players/p1/x.png"),
    ).toBeNull();
  });

  it("rejects a malformed URL and an empty key", () => {
    const svc = service(true);
    expect(svc.keyFromFileUrl("kyc", "not-a-url")).toBeNull();
    expect(svc.keyFromFileUrl("kyc", "https://r2.stub.local/aureus-kyc/")).toBeNull();
  });
});
