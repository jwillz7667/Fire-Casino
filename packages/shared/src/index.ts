// Public surface of @aureus/shared. Permissions and the per-domain API zod
// schemas are added in their respective build phases.
//
// NOTE: the Node-only dotenv loader is intentionally NOT re-exported here — it
// imports node:fs/node:path and would pollute the browser bundle of the Next.js
// apps that consume this barrel. Server processes import it from the dedicated
// "@aureus/shared/dotenv" subpath instead.
export * from "./env";
export * from "./money";
export * from "./enums";
export * from "./permissions";
export * from "./platform";
export * from "./scope";
export * from "./schemas";
