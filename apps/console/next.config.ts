import type { NextConfig } from "next";

const config: NextConfig = {
  reactStrictMode: true,
  // Workspace packages are shipped as source and transpiled by Next.
  transpilePackages: ["@aureus/ui"],
  eslint: {
    // Linting is run as a separate workspace task (turbo run lint), not inline.
    ignoreDuringBuilds: true,
  },
};

export default config;
