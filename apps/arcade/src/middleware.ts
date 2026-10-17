import { isIP } from "node:net";
import { NextResponse, type NextRequest } from "next/server";

/** Render's public edge overwrites CF-Connecting-IP. Carry that verified client
 * address across the fixed API rewrite, authenticated by a server-only secret.
 * Never trust a browser-supplied proxy assertion or a generic X-Forwarded-For.
 */
export function middleware(request: NextRequest): NextResponse {
  const headers = new Headers(request.headers);
  headers.delete("x-firecasino-client-ip");
  headers.delete("x-firecasino-proxy-proof");

  const secret = process.env.FRONTEND_PROXY_SECRET;
  const clientIp = headers.get("cf-connecting-ip");
  if (
    process.env.NEXT_PUBLIC_API_PROXY === "true" &&
    process.env.RENDER === "true" &&
    secret !== undefined &&
    secret.length >= 32 &&
    clientIp !== null &&
    isIP(clientIp) !== 0
  ) {
    headers.set("x-firecasino-client-ip", clientIp);
    headers.set("x-firecasino-proxy-proof", secret);
  }

  // These are upstream REQUEST headers; putting them on the response would
  // expose the secret to the browser.
  return NextResponse.next({ request: { headers } });
}

export const config = {
  matcher: "/api/v1/:path*",
  runtime: "nodejs",
};
