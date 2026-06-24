import { timingSafeEqual } from "node:crypto";
import type { NextFunction, Request, Response } from "express";

/** Length-guarded constant-time compare (avoids leaking the secret via timing). */
function secretMatches(provided: unknown, secret: string): boolean {
  if (typeof provided !== "string") return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Geo headers the app trusts for region resolution (see regionFromRequest). */
const GEO_HEADERS = ["cf-ipcountry", "x-vercel-ip-country", "x-country", "x-appengine-country"];
/** Header the trusted CDN/edge injects to prove a request actually transited it. */
const EDGE_PROOF_HEADER = "x-edge-proof";

/**
 * GEO-1 hardening. The region headers (CF-IPCountry / X-Vercel-IP-Country) are
 * forgeable: Express `trust proxy` only governs req.ip / X-Forwarded-For, NOT custom
 * headers, so a client reaching the origin directly (e.g. Railway's public host) could
 * spoof an allowed country and defeat the geo gate. When GEO_EDGE_HEADER_SECRET is
 * configured, the trusted edge must inject `x-edge-proof: <secret>`; any request that
 * does NOT carry the matching proof has its geo headers STRIPPED here, so
 * regionFromRequest resolves no region and the player-facing gates fail closed. The
 * proof header is always removed before it reaches a handler. Unset (dev) → no-op.
 */
export function stripUntrustedGeoHeaders(secret: string | undefined) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (secret) {
      if (!secretMatches(req.headers[EDGE_PROOF_HEADER], secret)) {
        for (const h of GEO_HEADERS) delete req.headers[h];
      }
      delete req.headers[EDGE_PROOF_HEADER];
    }
    next();
  };
}
