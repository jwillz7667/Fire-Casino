import { api } from "./api";
import type { PresignResult } from "./types";

/**
 * Two-step upload: ask the API for a presigned PUT URL, then upload the file
 * directly to object storage. Returns the public/object URL to attach to the
 * record (order proof, KYC doc, payout proof).
 */
export async function uploadViaPresign(presignPath: string, file: File): Promise<string> {
  const presign = await api.post<PresignResult>(presignPath, { filename: file.name });
  const res = await fetch(presign.uploadUrl, {
    method: "PUT",
    headers: { "Content-Type": file.type || "application/octet-stream" },
    body: file,
  });
  if (!res.ok) throw new Error("Upload failed");
  return presign.publicUrl;
}
