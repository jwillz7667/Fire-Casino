import swc from "unplugin-swc";
import { defineConfig } from "vitest/config";

// unplugin-swc is required: Vitest transpiles with esbuild, which does NOT emit
// `emitDecoratorMetadata`, so NestJS dependency injection would break in tests.
export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["src/**/*.test.ts", "test/**/*.test.ts"],
    setupFiles: ["./test/setup.ts"],
    // Integration tests share one Postgres; run files serially to avoid races.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 30_000,
    root: "./",
  },
  plugins: [swc.vite()],
});
