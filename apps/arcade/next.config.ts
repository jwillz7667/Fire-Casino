import type { NextConfig } from "next";
import { apiProxyRewrites } from "./api-proxy";

const securityHeaders = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  {
    key: "Content-Security-Policy",
    value: "frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
  },
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
    ignoreDuringBuilds: true,
  },
  async rewrites() {
    return apiProxyRewrites(process.env);
  },
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      { source: "/api/v1/:path*", headers: [{ key: "Cache-Control", value: "private, no-store" }] },
    ];
  },
};

export default config;
