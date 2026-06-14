import type { NextConfig } from "next";

const config: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@aureus/ui"],
  eslint: {
    ignoreDuringBuilds: true,
  },
};

export default config;
