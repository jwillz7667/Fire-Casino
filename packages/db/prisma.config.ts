import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { config as loadEnvFile } from "dotenv";
import { defineConfig } from "prisma/config";

// Load the monorepo root .env so Prisma CLI commands run from packages/db pick
// up DATABASE_URL. Self-contained (no @aureus/shared import) so it works before
// the workspace is built. In CI/production the env is set directly and no .env
// file exists — this is a harmless no-op.
function loadRootEnv(): void {
  let dir = process.cwd();
  for (;;) {
    if (existsSync(join(dir, "pnpm-workspace.yaml"))) {
      const envPath = join(dir, ".env");
      if (existsSync(envPath)) loadEnvFile({ path: envPath });
      return;
    }
    const parent = dirname(dir);
    if (parent === dir) return;
    dir = parent;
  }
}

loadRootEnv();

export default defineConfig({
  schema: join("prisma", "schema.prisma"),
  migrations: {
    seed: "tsx prisma/seed.ts",
  },
});
