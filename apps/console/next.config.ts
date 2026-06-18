import type { NextConfig } from "next";

/**
 * Hardening headers for the privileged back-office (security audit FE-S3). The
 * headline fix is anti-clickjacking on a money console: frame-ancestors 'none' +
 * X-Frame-Options DENY so the RBAC UI can't be UI-redressed into mint/approve
 * clicks. A scoped `frame-ancestors`-only CSP is used so it can't break the app's
 * own resource loading; a full nonce-based CSP is a tracked follow-up.
 */
const securityHeaders = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'; base-uri 'self'; form-action 'self'" },
  ...(process.env.NODE_ENV === "production"
    ? [{ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" }]
    : []),
];

const config: NextConfig = {
  reactStrictMode: true,
  // The design system ships as source and is transpiled by Next. @aureus/shared
  // ships prebuilt and is Node-free in its public barrel (the dotenv loader lives
  // behind the @aureus/shared/dotenv subpath, so the browser bundle stays clean).
  transpilePackages: ["@aureus/ui"],
  eslint: {
    // Linting is run as a separate workspace task (turbo run lint), not inline.
    ignoreDuringBuilds: true,
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default config;
