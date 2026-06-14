import swc from "unplugin-swc";
import { defineConfig } from "vitest/config";

// unplugin-swc is required: Vitest transpiles with esbuild, which does NOT emit
// `emitDecoratorMetadata`, so NestJS dependency injection would break in tests.
export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["src/**/*.test.ts", "test/**/*.test.ts"],
    root: "./",
  },
  plugins: [swc.vite()],
});
