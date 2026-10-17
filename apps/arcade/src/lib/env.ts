// NEXT_PUBLIC_* values are inlined at build time. HTTP may use the frontend's
// own origin so refresh cookies work without third-party-cookie permissions;
// realtime always connects directly to the API origin.
export const API_ORIGIN = (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000").replace(
  /\/+$/,
  "",
);
export const API_BASE =
  process.env.NEXT_PUBLIC_API_PROXY === "true" ? "/api/v1" : `${API_ORIGIN}/api/v1`;
