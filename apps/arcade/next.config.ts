import type { NextConfig } from "next";

const config: NextConfig = {
  reactStrictMode: true,
  // The design system ships as source and is transpiled by Next. @aureus/shared
  // ships prebuilt and is Node-free in its public barrel (the dotenv loader lives
  // behind the @aureus/shared/dotenv subpath, so the browser bundle stays clean).
  transpilePackages: ["@aureus/ui"],
  eslint: {
    ignoreDuringBuilds: true,
  },
};

export default config;
