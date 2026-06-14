import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import dotenv from "dotenv";

/**
 * Loads the monorepo's root `.env` for local development. Walks up from the
 * current working directory to the workspace root (the directory containing
 * `pnpm-workspace.yaml`) and loads its `.env`, then any `.env` in cwd.
 *
 * dotenv does NOT override variables already present in process.env, so a
 * platform-provided environment (Railway/Vercel/CI) always wins over a local
 * file. In production with no `.env` present this is a harmless no-op.
 *
 * Call once at process start, before loadEnv().
 */
export function loadDotenv(startDir: string = process.cwd()): void {
  const root = findWorkspaceRoot(startDir);
  if (root) {
    const rootEnv = join(root, ".env");
    if (existsSync(rootEnv)) dotenv.config({ path: rootEnv });
  }
  const localEnv = join(startDir, ".env");
  if (localEnv !== join(root ?? "", ".env") && existsSync(localEnv)) {
    dotenv.config({ path: localEnv });
  }
}

function findWorkspaceRoot(startDir: string): string | null {
  let dir = startDir;
  for (;;) {
    if (existsSync(join(dir, "pnpm-workspace.yaml"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}
