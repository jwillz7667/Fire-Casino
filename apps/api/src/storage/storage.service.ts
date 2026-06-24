import { randomUUID } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import { type Env } from "@aureus/shared";
import { ENV } from "../config/config.module";
import { presignR2Url, type R2Credentials } from "./r2-presigner";

export interface PresignedUpload {
  key: string;
  uploadUrl: string;
  fileUrl: string;
}

const UPLOAD_EXPIRY_SECONDS = 300; // 5 min to complete an upload
const DOWNLOAD_EXPIRY_SECONDS = 300; // 5 min signed-read window for KYC preview

/**
 * Object storage (Cloudflare R2) abstraction. Uses a real S3-compatible SigV4
 * presigner when R2 credentials are configured; otherwise falls back to the dev
 * stub (deterministic-looking URLs, no network) so tests and local dev work
 * without R2. Used for credit-order payment proof and KYC documents (audit A2).
 */
@Injectable()
export class StorageService {
  private readonly creds: R2Credentials | null;

  constructor(@Inject(ENV) private readonly env: Env) {
    this.creds =
      env.R2_ACCOUNT_ID && env.R2_ACCESS_KEY_ID && env.R2_SECRET_ACCESS_KEY
        ? {
            accountId: env.R2_ACCOUNT_ID,
            accessKeyId: env.R2_ACCESS_KEY_ID,
            secretAccessKey: env.R2_SECRET_ACCESS_KEY,
          }
        : null;

    // SECRETS-3: never serve the dev stub in production — it would silently accept
    // (and drop) KYC PII uploads to a fake host. env validation already requires
    // R2_* in production; this is the last-line guard at the storage boundary.
    if (this.env.NODE_ENV === "production" && !this.creds) {
      throw new Error("StorageService: R2 credentials are required in production (refusing the dev stub client)");
    }
  }

  private bucketName(bucket: "assets" | "kyc"): string {
    return bucket === "kyc" ? this.env.R2_BUCKET_KYC : this.env.R2_BUCKET_ASSETS;
  }

  presignUpload(bucket: "assets" | "kyc", folder: string, filename: string): PresignedUpload {
    const bucketName = this.bucketName(bucket);
    const key = `${folder}/${randomUUID()}-${sanitize(filename)}`;

    if (!this.creds) {
      const base = `https://r2.stub.local/${bucketName}`;
      return { key, uploadUrl: `${base}/${key}?stub-upload=true`, fileUrl: `${base}/${key}` };
    }

    const uploadUrl = presignR2Url({
      creds: this.creds,
      method: "PUT",
      bucket: bucketName,
      key,
      expiresSeconds: UPLOAD_EXPIRY_SECONDS,
      now: new Date(),
    });
    // Canonical object URL (private; viewed via a signed GET — presignDownload).
    const fileUrl = `https://${this.creds.accountId}.r2.cloudflarestorage.com/${bucketName}/${key}`;
    return { key, uploadUrl, fileUrl };
  }

  /**
   * Recover the object key from a stored file URL, but only if it points at our
   * configured storage (the R2 host or the dev stub) and the named bucket. Used
   * to presign a read for a document we previously stored a canonical URL for.
   * Returns null for any URL we don't own — never presign an arbitrary host.
   */
  keyFromFileUrl(bucket: "assets" | "kyc", fileUrl: string): string | null {
    let parsed: URL;
    try {
      parsed = new URL(fileUrl);
    } catch {
      return null;
    }
    const ownHost =
      parsed.hostname === "r2.stub.local" || parsed.hostname.endsWith(".r2.cloudflarestorage.com");
    if (!ownHost) return null;
    const prefix = `/${this.bucketName(bucket)}/`;
    if (!parsed.pathname.startsWith(prefix)) return null;
    const key = decodeURIComponent(parsed.pathname.slice(prefix.length));
    return key.length > 0 ? key : null;
  }

  /** Time-limited signed GET so privileged reviewers can view a private object (KYC docs). */
  presignDownload(bucket: "assets" | "kyc", key: string): string {
    const bucketName = this.bucketName(bucket);
    if (!this.creds) return `https://r2.stub.local/${bucketName}/${key}?stub-download=true`;
    return presignR2Url({
      creds: this.creds,
      method: "GET",
      bucket: bucketName,
      key,
      expiresSeconds: DOWNLOAD_EXPIRY_SECONDS,
      now: new Date(),
    });
  }
}

function sanitize(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120);
}
