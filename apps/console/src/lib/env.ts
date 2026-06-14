// Frontend runtime config. NEXT_PUBLIC_* is inlined at build time; fall back to
// the local API so the app boots without an .env in dev.
export const API_ORIGIN = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";
export const API_BASE = `${API_ORIGIN}/api/v1`;
