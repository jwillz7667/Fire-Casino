/**
 * Typed fetch client for the player surface. Attaches the in-memory bearer
 * token, sends the refresh cookie (credentials: include), serializes JSON
 * bodies (BigInt → integer string to match zMinor), and parses the
 * { error: { code, message, details? } } envelope into a thrown ApiError.
 *
 * On 401 it attempts ONE /auth/refresh then retries; if that fails it clears
 * the token and hands off to the registered auth-lost handler (redirect to
 * login). Refreshes are single-flighted so concurrent 401s share one round-trip.
 */

const API_BASE = `${process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000"}/api/v1`;

export class ApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

let accessToken: string | null = null;

export function setAccessToken(token: string | null): void {
  accessToken = token;
}

export function getAccessToken(): string | null {
  return accessToken;
}

type AuthLostHandler = () => void;
let authLostHandler: AuthLostHandler | null = null;

export function setAuthLostHandler(handler: AuthLostHandler | null): void {
  authLostHandler = handler;
}

function bigintReplacer(_key: string, value: unknown): unknown {
  return typeof value === "bigint" ? value.toString() : value;
}

interface RequestOptions {
  body?: unknown;
  idempotencyKey?: string;
  signal?: AbortSignal;
  query?: Record<string, string | number | boolean | undefined>;
  skipAuthRetry?: boolean;
}

let refreshInFlight: Promise<boolean> | null = null;

/** Single-flighted refresh. Resolves true when a fresh access token was set. */
export async function tryRefresh(): Promise<boolean> {
  refreshInFlight ??= (async () => {
    try {
      const res = await fetch(`${API_BASE}/auth/refresh`, {
        method: "POST",
        credentials: "include",
      });
      if (!res.ok) return false;
      const data = (await res.json()) as { accessToken?: string };
      if (data.accessToken) {
        setAccessToken(data.accessToken);
        return true;
      }
      return false;
    } catch {
      return false;
    }
  })();

  try {
    return await refreshInFlight;
  } finally {
    refreshInFlight = null;
  }
}

async function toApiError(res: Response, statusOverride?: number): Promise<ApiError> {
  let code = "UNKNOWN";
  let message = res.statusText || "Request failed";
  let details: unknown;
  try {
    const data = (await res.json()) as {
      error?: { code?: string; message?: string; details?: unknown };
    };
    if (data.error) {
      code = data.error.code ?? code;
      message = data.error.message ?? message;
      details = data.error.details;
    }
  } catch {
    // Non-JSON error body; keep the status text.
  }
  return new ApiError(code, message, statusOverride ?? res.status, details);
}

async function request<T>(method: string, path: string, opts: RequestOptions = {}): Promise<T> {
  const url = new URL(`${API_BASE}${path}`);
  if (opts.query) {
    for (const [key, value] of Object.entries(opts.query)) {
      if (value !== undefined && value !== "") url.searchParams.set(key, String(value));
    }
  }

  const headers: Record<string, string> = { Accept: "application/json" };
  if (opts.body !== undefined) headers["Content-Type"] = "application/json";
  const token = getAccessToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  if (opts.idempotencyKey) headers["Idempotency-Key"] = opts.idempotencyKey;

  const res = await fetch(url.toString(), {
    method,
    headers,
    credentials: "include",
    signal: opts.signal,
    body: opts.body !== undefined ? JSON.stringify(opts.body, bigintReplacer) : undefined,
  });

  if (res.status === 401 && !opts.skipAuthRetry && path !== "/auth/refresh") {
    const refreshed = await tryRefresh();
    if (refreshed) return request<T>(method, path, { ...opts, skipAuthRetry: true });
    setAccessToken(null);
    authLostHandler?.();
    throw await toApiError(res, 401);
  }

  if (!res.ok) throw await toApiError(res);
  if (res.status === 204) return undefined as T;

  const text = await res.text();
  return (text ? (JSON.parse(text) as T) : (undefined as T));
}

export const api = {
  get: <T>(path: string, opts?: Pick<RequestOptions, "query" | "signal">): Promise<T> =>
    request<T>("GET", path, opts),
  post: <T>(path: string, body?: unknown, opts?: Omit<RequestOptions, "body">): Promise<T> =>
    request<T>("POST", path, { ...opts, body }),
  patch: <T>(path: string, body?: unknown, opts?: Omit<RequestOptions, "body">): Promise<T> =>
    request<T>("PATCH", path, { ...opts, body }),
  del: <T>(path: string, opts?: RequestOptions): Promise<T> => request<T>("DELETE", path, opts),
};
