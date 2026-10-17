import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function deploymentCommands() {
  const databaseDirectory = resolve(repoRoot, "packages/db");
  const requireFromDatabase = createRequire(resolve(databaseDirectory, "package.json"));
  return {
    migration: {
      name: "migrations",
      args: [requireFromDatabase.resolve("prisma/build/index.js"), "migrate", "deploy"],
      cwd: databaseDirectory,
    },
    services: [
      { name: "API", args: [resolve(repoRoot, "apps/api/dist/main.js")], cwd: repoRoot },
      { name: "worker", args: [resolve(repoRoot, "apps/api/dist/worker.js")], cwd: repoRoot },
    ],
  };
}

/** Run both backend processes on hosts that provide only one free service. */
export async function runBackend({ migration, services, graceMs = 25_000 }) {
  const children = new Set();
  let stopping = false;
  let exitCode = 0;
  let deadline;
  let finish;
  const finished = new Promise((resolveFinished) => {
    finish = resolveFinished;
  });

  function signalChild(child, signal) {
    if (!child.pid) return;
    try {
      // A separate process group also reaches Prisma's schema-engine subprocess.
      if (process.platform === "win32") child.kill(signal);
      else process.kill(-child.pid, signal);
    } catch (error) {
      if (error.code !== "ESRCH") console.error("Could not signal a backend process.");
    }
  }

  function finishIfStopped() {
    if (!stopping || children.size > 0) return;
    clearTimeout(deadline);
    process.off("SIGTERM", onTerminate);
    process.off("SIGINT", onInterrupt);
    finish(exitCode);
  }

  function stop(code, signal = "SIGTERM") {
    if (stopping) return;
    stopping = true;
    exitCode = code;
    for (const child of children) signalChild(child, signal);
    if (children.size > 0) {
      deadline = setTimeout(() => {
        console.error("Backend shutdown exceeded its grace period; stopping remaining processes.");
        exitCode ||= 1;
        for (const child of children) signalChild(child, "SIGKILL");
      }, graceMs);
    }
    finishIfStopped();
  }

  function onTerminate() {
    stop(0, "SIGTERM");
  }
  function onInterrupt() {
    stop(0, "SIGINT");
  }
  process.on("SIGTERM", onTerminate);
  process.on("SIGINT", onInterrupt);

  function launch(command, service = false) {
    const child = spawn(process.execPath, command.args, {
      cwd: command.cwd,
      env: process.env,
      stdio: "inherit",
      detached: process.platform !== "win32",
    });
    children.add(child);
    return new Promise((resolveExit) => {
      child.once("error", () => {
        console.error(`${command.name} could not start.`);
        children.delete(child);
        stop(1);
        resolveExit(1);
        finishIfStopped();
      });
      child.once("exit", (code) => {
        children.delete(child);
        if (service && !stopping) {
          console.error(`${command.name} exited unexpectedly; stopping the backend.`);
          signalChild(child, "SIGTERM");
          stop(code || 1);
        }
        resolveExit(code ?? 1);
        finishIfStopped();
      });
    });
  }

  const migrationCode = await launch(migration);
  if (stopping) return finished;
  if (migrationCode !== 0) {
    console.error("Database migrations failed; backend processes were not started.");
    stop(migrationCode);
    return finished;
  }
  for (const service of services) void launch(service, true);
  return finished;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = await runBackend(deploymentCommands());
  } catch {
    console.error("Backend startup failed. Verify dependencies and deployment configuration.");
    process.exitCode = 1;
  }
}
