import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import { type Env } from "@aureus/shared";
import { ENV } from "../config/config.module";

const PREFIX = "gcm:";

/**
 * Encrypts TOTP secrets at rest (security audit — the schema claimed "encrypted"
 * but stored plaintext). AES-256-GCM with a key derived from a server secret, so
 * no extra env is required. Format: `gcm:<iv>:<tag>:<ciphertext>` (base64).
 * decrypt() tolerates legacy plaintext (base32 TOTP secrets never contain ':'),
 * so it is safe even if an un-encrypted secret predates this change.
 */
@Injectable()
export class MfaCryptoService {
  private readonly key: Buffer;

  constructor(@Inject(ENV) env: Env) {
    this.key = createHash("sha256").update(`mfa:${env.JWT_REFRESH_SECRET}`).digest();
  }

  encrypt(plain: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key, iv);
    const ciphertext = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
    const tag = cipher.getAuthTag();
    return `${PREFIX}${iv.toString("base64")}:${tag.toString("base64")}:${ciphertext.toString("base64")}`;
  }

  decrypt(stored: string): string {
    if (!stored.startsWith(PREFIX)) return stored; // legacy plaintext tolerance
    const [, ivB64, tagB64, ctB64] = stored.split(":");
    if (!ivB64 || !tagB64 || !ctB64) throw new Error("Malformed encrypted MFA secret");
    const decipher = createDecipheriv("aes-256-gcm", this.key, Buffer.from(ivB64, "base64"));
    decipher.setAuthTag(Buffer.from(tagB64, "base64"));
    return Buffer.concat([decipher.update(Buffer.from(ctB64, "base64")), decipher.final()]).toString("utf8");
  }
}
