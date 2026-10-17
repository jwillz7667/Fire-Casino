import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const supervisorUrl = new URL("./start-backend.mjs", import.meta.url).href;

async function startFixture(
  t,
  {
    migration = "success",
    worker = "hold",
    api = "hold",
    graceMs = 250,
    environment = {},
    captureEnvironment = false,
  } = {},
) {
  const directory = await mkdtemp(join(tmpdir(), "backend-supervisor-"));
  const eventsPath = join(directory, "events.jsonl");
  const childPath = join(directory, "child.mjs");
  await writeFile(
    childPath,
    `
    import { appendFileSync } from "node:fs";
    const [path, name, mode] = process.argv.slice(2);
    const record = (event, extra = {}) => appendFileSync(path, JSON.stringify({ name, event, ...extra }) + "\\n");
    record("started");
    if (${JSON.stringify(captureEnvironment)}) record("environment", {
      databaseUrl: process.env.DATABASE_URL,
      migrationUrlPresent: Object.hasOwn(process.env, "MIGRATION_DATABASE_URL"),
    });
    for (const signal of ["SIGTERM", "SIGINT"]) process.on(signal, () => {
      record(signal);
      if (mode !== "ignore") process.exit(0);
    });
    if (mode === "success") { record("completed"); process.exit(0); }
    else if (mode === "fail") process.exit(7);
    else {
      setInterval(() => {}, 1000);
      if (mode === "crash") setTimeout(() => process.exit(12), 150);
    }
  `,
  );
  const wrapperPath = join(directory, "supervisor.mjs");
  const command = (name, mode) => ({
    name,
    args: [childPath, eventsPath, name, mode],
    cwd: directory,
  });
  await writeFile(
    wrapperPath,
    `
    import { runBackend } from ${JSON.stringify(supervisorUrl)};
    process.exitCode = await runBackend(${JSON.stringify({
      migration: command("migration", migration),
      services: [command("api", api), command("worker", worker)],
      graceMs,
    })});
  `,
  );
  const child = spawn(process.execPath, [wrapperPath], {
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, ...environment },
  });
  let output = "";
  child.stdout.on("data", (data) => {
    output += data;
  });
  child.stderr.on("data", (data) => {
    output += data;
  });
  const exited = new Promise((resolveExit, rejectExit) => {
    child.once("error", rejectExit);
    child.once("exit", (code, signal) => resolveExit({ code, signal }));
  });
  t.after(async () => {
    child.kill("SIGTERM");
    await exited;
    await rm(directory, { recursive: true, force: true });
  });
  async function events() {
    try {
      return (await readFile(eventsPath, "utf8"))
        .trim()
        .split("\n")
        .filter(Boolean)
        .map(JSON.parse);
    } catch (error) {
      if (error.code === "ENOENT") return [];
      throw error;
    }
  }
  async function waitFor(name, event = "started") {
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      if ((await events()).some((row) => row.name === name && row.event === event)) return;
      if (child.exitCode !== null || child.signalCode !== null)
        assert.fail(`Supervisor exited early: ${output}`);
      await new Promise((resolvePoll) => setTimeout(resolvePoll, 10));
    }
    assert.fail(`Timed out waiting for ${name}: ${output}`);
  }
  return { child, exited, events, waitFor, output: () => output };
}

test(
  "failed migrations prevent either backend process from starting",
  { timeout: 10_000 },
  async (t) => {
    const fixture = await startFixture(t, { migration: "fail" });
    assert.equal((await fixture.exited).code, 7);
    assert.deepEqual(await fixture.events(), [{ name: "migration", event: "started" }]);
  },
);

test(
  "migrations complete before services start, and a crashed worker stops the API",
  { timeout: 10_000 },
  async (t) => {
    const fixture = await startFixture(t, { worker: "crash" });
    assert.equal((await fixture.exited).code, 12);
    const events = await fixture.events();
    assert.deepEqual(events.slice(0, 2), [
      { name: "migration", event: "started" },
      { name: "migration", event: "completed" },
    ]);
    assert.ok(events.some((row) => row.name === "api" && row.event === "SIGTERM"));
  },
);

for (const signal of ["SIGTERM", "SIGINT"]) {
  test(`${signal} reaches both services and exits cleanly`, { timeout: 10_000 }, async (t) => {
    const fixture = await startFixture(t);
    await fixture.waitFor("api");
    await fixture.waitFor("worker");
    fixture.child.kill(signal);
    assert.equal((await fixture.exited).code, 0);
    const events = await fixture.events();
    for (const name of ["api", "worker"]) {
      assert.ok(events.some((row) => row.name === name && row.event === signal));
    }
  });
}

test("shutdown during migrations never launches services", { timeout: 10_000 }, async (t) => {
  const fixture = await startFixture(t, { migration: "hold" });
  await fixture.waitFor("migration");
  fixture.child.kill("SIGTERM");
  assert.equal((await fixture.exited).code, 0);
  assert.deepEqual(await fixture.events(), [
    { name: "migration", event: "started" },
    { name: "migration", event: "SIGTERM" },
  ]);
});

test(
  "an unresponsive service is killed after the shutdown deadline",
  { timeout: 10_000 },
  async (t) => {
    const fixture = await startFixture(t, { api: "ignore", graceMs: 100 });
    await fixture.waitFor("api");
    await fixture.waitFor("worker");
    fixture.child.kill("SIGTERM");
    assert.equal((await fixture.exited).code, 1);
    assert.match(fixture.output(), /exceeded its grace period/);
  },
);

for (const migrationUrl of ["postgresql://migrator.invalid/test", ""]) {
  test(
    migrationUrl
      ? "owner credentials are passed only to migrations, never API or worker"
      : "migrations fall back to the runtime URL when no override is configured",
    { timeout: 10_000 },
    async (t) => {
      const runtimeUrl = "postgresql://runtime.invalid/test";
      const fixture = await startFixture(t, {
        captureEnvironment: true,
        environment: { DATABASE_URL: runtimeUrl, MIGRATION_DATABASE_URL: migrationUrl },
      });
      await fixture.waitFor("api", "environment");
      await fixture.waitFor("worker", "environment");
      const environment = (await fixture.events()).filter((row) => row.event === "environment");
      for (const name of ["migration", "api", "worker"]) {
        assert.deepEqual(
          environment.find((row) => row.name === name),
          {
            name,
            event: "environment",
            databaseUrl: name === "migration" ? migrationUrl || runtimeUrl : runtimeUrl,
            migrationUrlPresent: false,
          },
        );
      }
      assert.doesNotMatch(fixture.output(), /postgresql:\/\//);
    },
  );
}
