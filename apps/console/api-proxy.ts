// Only deployment configuration chooses the upstream. Never derive it from a
// request header, URL parameter or browser input (this must not be an open proxy).
export function apiProxyRewrites(
  env: NodeJS.ProcessEnv,
): { source: string; destination: string }[] {
  if (env.NEXT_PUBLIC_API_PROXY !== "true") return [];
  if (!env.NEXT_PUBLIC_API_URL)
    throw new Error("NEXT_PUBLIC_API_URL is required when NEXT_PUBLIC_API_PROXY=true");

  const upstream = new URL(env.NEXT_PUBLIC_API_URL);
  const localHttp =
    upstream.protocol === "http:" &&
    ["localhost", "127.0.0.1", "[::1]"].includes(upstream.hostname);
  if (
    (upstream.protocol !== "https:" && !localHttp) ||
    upstream.username ||
    upstream.password ||
    upstream.search ||
    upstream.hash ||
    upstream.pathname !== "/"
  )
    throw new Error(
      "NEXT_PUBLIC_API_URL must be an HTTPS origin (local HTTP is allowed for development)",
    );

  return [{ source: "/api/v1/:path*", destination: `${upstream.origin}/api/v1/:path*` }];
}
