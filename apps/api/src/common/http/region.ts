import type { Request } from "express";

/**
 * Resolve the client's region (ISO country code) from CDN/edge headers (CR1).
 * Cloudflare sets CF-IPCountry; Vercel sets X-Vercel-IP-Country. Returns
 * undefined when no header is present or the edge reports an unknown/anonymizing
 * value, so geo enforcement only acts on a confidently-resolved region.
 */
export function regionFromRequest(req: Request): string | undefined {
  const h = req.headers;
  const raw =
    h["cf-ipcountry"] ??
    h["x-vercel-ip-country"] ??
    h["x-country"] ??
    h["x-appengine-country"];
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (!value) return undefined;
  const code = value.trim().toUpperCase();
  // CF uses "XX" (unknown) and "T1" (Tor); treat both as unresolved.
  if (code === "" || code === "XX" || code === "T1") return undefined;
  return code;
}
