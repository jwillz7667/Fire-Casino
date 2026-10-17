import { timingSafeEqual } from "node:crypto";
import { isIP } from "node:net";
import type { NextFunction, Request, Response } from "express";

/** The API keeps trust-proxy=1 for direct traffic. Our authenticated frontend
 * proxy can assert one ingress-verified client IP without widening trust in
 * arbitrary X-Forwarded-For chains. Invalid or absent assertions are ignored.
 */
export function trustedFrontendIp(secret?: string) {
  const expected = secret ? Buffer.from(secret, "utf8") : null;
  return (req: Request, _res: Response, next: NextFunction): void => {
    const clientIp = req.headers["x-firecasino-client-ip"];
    const proof = req.headers["x-firecasino-proxy-proof"];
    // These headers are internal transport credentials, never controller input.
    delete req.headers["x-firecasino-client-ip"];
    delete req.headers["x-firecasino-proxy-proof"];
    if (
      expected &&
      typeof clientIp === "string" &&
      isIP(clientIp) !== 0 &&
      typeof proof === "string" &&
      Buffer.byteLength(proof, "utf8") === expected.length &&
      timingSafeEqual(Buffer.from(proof, "utf8"), expected)
    ) {
      // Express exposes req.ip as a prototype getter. An own value updates the
      // address used by every guard and audit context while preserving the
      // socket peer and the original proxy chain for transport diagnostics.
      Object.defineProperty(req, "ip", { configurable: true, enumerable: true, value: clientIp });
    }
    next();
  };
}
