import type { NextFunction, Request, Response } from "express";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/** Cookie-backed auth needs an explicit origin check when SameSite=None.
 * CORS alone only prevents reading a response; it does not prevent cross-site
 * login, rotation, or logout requests from changing a browser's session.
 */
export function authOriginProtection(allowedOrigins: readonly string[]) {
  const allowed = new Set(allowedOrigins);
  return (req: Request, res: Response, next: NextFunction): void => {
    if (SAFE_METHODS.has(req.method)) return next();
    const origin = req.headers.origin;
    const denied =
      origin !== undefined ? !allowed.has(origin) : req.headers["sec-fetch-site"] === "cross-site";
    if (denied) {
      res.status(403).json({ error: { code: "FORBIDDEN", message: "Untrusted request origin" } });
      return;
    }
    // Non-browser API/CLI clients do not send Origin or Fetch Metadata.
    next();
  };
}
