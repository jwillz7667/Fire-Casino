import { createHash, createHmac } from "node:crypto";

/**
 * Dependency-free AWS Signature V4 presigner for Cloudflare R2 (S3-compatible).
 * Generates query-string-authenticated PUT/GET URLs with no AWS SDK and no
 * network call — signing is pure computation. R2 uses region "auto" and the
 * endpoint https://<accountId>.r2.cloudflarestorage.com.
 */
export interface R2Credentials {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
}

const REGION = "auto";
const SERVICE = "s3";

function sha256Hex(data: string): string {
  return createHash("sha256").update(data, "utf8").digest("hex");
}

function hmac(key: Buffer | string, data: string): Buffer {
  return createHmac("sha256", key).update(data, "utf8").digest();
}

/** RFC3986 encoding (AWS-strict): encodeURIComponent plus the four it leaves out. */
function uriEncode(value: string): string {
  return encodeURIComponent(value).replace(
    /[!'()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

/** Encode an object key, preserving the path separators. */
function encodeKey(key: string): string {
  return key.split("/").map(uriEncode).join("/");
}

function amzTimestamps(now: Date): { amzDate: string; dateStamp: string } {
  const iso = now.toISOString(); // 2026-06-18T00:00:00.000Z
  const amzDate = `${iso.slice(0, 4)}${iso.slice(5, 7)}${iso.slice(8, 10)}T${iso.slice(11, 13)}${iso.slice(14, 16)}${iso.slice(17, 19)}Z`;
  return { amzDate, dateStamp: amzDate.slice(0, 8) };
}

export function presignR2Url(args: {
  creds: R2Credentials;
  method: "PUT" | "GET";
  bucket: string;
  key: string;
  expiresSeconds: number;
  now: Date;
}): string {
  const { creds, method, bucket, key, expiresSeconds, now } = args;
  const host = `${creds.accountId}.r2.cloudflarestorage.com`;
  const canonicalUri = `/${uriEncode(bucket)}/${encodeKey(key)}`;
  const { amzDate, dateStamp } = amzTimestamps(now);
  const credentialScope = `${dateStamp}/${REGION}/${SERVICE}/aws4_request`;

  const query: Record<string, string> = {
    "X-Amz-Algorithm": "AWS4-HMAC-SHA256",
    "X-Amz-Credential": `${creds.accessKeyId}/${credentialScope}`,
    "X-Amz-Date": amzDate,
    "X-Amz-Expires": String(expiresSeconds),
    "X-Amz-SignedHeaders": "host",
  };
  const canonicalQuery = Object.keys(query)
    .sort()
    .map((k) => `${uriEncode(k)}=${uriEncode(query[k] as string)}`)
    .join("&");

  const canonicalRequest = [
    method,
    canonicalUri,
    canonicalQuery,
    `host:${host}\n`,
    "host",
    "UNSIGNED-PAYLOAD",
  ].join("\n");

  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    credentialScope,
    sha256Hex(canonicalRequest),
  ].join("\n");

  const kDate = hmac(`AWS4${creds.secretAccessKey}`, dateStamp);
  const kRegion = hmac(kDate, REGION);
  const kService = hmac(kRegion, SERVICE);
  const kSigning = hmac(kService, "aws4_request");
  const signature = createHmac("sha256", kSigning).update(stringToSign, "utf8").digest("hex");

  return `https://${host}${canonicalUri}?${canonicalQuery}&X-Amz-Signature=${signature}`;
}
