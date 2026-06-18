import type { NextFunction, Request, Response } from "express";

/**
 * Hardening headers for the JSON API (security audit S4). Dependency-free
 * equivalent of helmet for an API that serves no HTML: a locked-down CSP,
 * anti-clickjacking, nosniff, no referrer leakage, and HSTS over TLS. Also strips
 * the framework's X-Powered-By fingerprint.
 */
export function securityHeaders(_req: Request, res: Response, next: NextFunction): void {
  res.removeHeader("X-Powered-By");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
  // The API returns only JSON; deny every content source and any framing.
  res.setHeader("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'");
  if (process.env.NODE_ENV === "production") {
    res.setHeader("Strict-Transport-Security", "max-age=63072000; includeSubDomains");
  }
  next();
}
