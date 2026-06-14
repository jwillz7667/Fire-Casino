import { randomUUID } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import { type Env } from "@aureus/shared";
import { ENV } from "../config/config.module";

export interface PresignedUpload {
  key: string;
  uploadUrl: string;
  fileUrl: string;
}

/**
 * Object storage (Cloudflare R2) abstraction. The interface is real; this is the
 * stub provider used in dev (docs/01 §8) — it generates deterministic-looking
 * URLs without contacting R2. A real S3/R2 presigner drops in behind the same
 * methods. Used for credit-order payment proof and KYC documents.
 */
@Injectable()
export class StorageService {
  constructor(@Inject(ENV) private readonly env: Env) {}

  presignUpload(bucket: "assets" | "kyc", folder: string, filename: string): PresignedUpload {
    const bucketName = bucket === "kyc" ? this.env.R2_BUCKET_KYC : this.env.R2_BUCKET_ASSETS;
    const key = `${folder}/${randomUUID()}-${sanitize(filename)}`;
    const base = `https://r2.stub.local/${bucketName}`;
    return {
      key,
      uploadUrl: `${base}/${key}?stub-upload=true`,
      fileUrl: `${base}/${key}`,
    };
  }
}

function sanitize(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120);
}
