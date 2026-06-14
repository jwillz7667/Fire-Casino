// Typed fetch client for the Aureus console.
//
// - Prefixes the versioned API base, attaches a Bearer token from the in-memory
//   store, and always sends the refresh cookie (credentials: "include").
// - Money mutations pass an Idempotency-Key.
// - The {error:{code,message}} envelope is parsed into a thrown ApiError.
// - On a 401 it attempts ONE /auth/refresh then retries; if refresh fails it
//   clears the token and notifies the registered session-expired handler.
//
// The BigInt JSON safety net is installed so any stray bigint in a request body
// serializes to an integer string instead of throwing (hard rule #1).
import "@aureus/shared/bigint";
import { API_BASE } from "./env";

export class ApiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details?: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export function isApiError(value: unknown): value is ApiError {
  return value instanceof ApiError;
}

// ---- in-memory token store ---------------------------------------------------

let accessToken: string | null = null;

export function setAccessToken(token: string | null): void {
  accessToken = token;
}

export function getAccessToken(): string | null {
  return accessToken;
}

type SessionExpiredHandler = () => void;
let sessionExpiredHandler: SessionExpiredHandler = () => {
  /* default no-op until the auth context registers one */
};

export function setSessionExpiredHandler(handler: SessionExpiredHandler): void {
  sessionExpiredHandler = handler;
}

// ---- refresh (deduped) -------------------------------------------------------

let refreshInFlight: Promise<boolean> | null = null;

async function doRefresh(): Promise<boolean> {
  try {
    const res = await fetch(`${API_BASE}/auth/refresh`, {
      method: "POST",
      credentials: "include",
    });
    if (!res.ok) return false;
    const data = (await res.json()) as { accessToken?: string };
    if (!data.accessToken) return false;
    accessToken = data.accessToken;
    return true;
  } catch {
    return false;
  }
}

export async function refreshSession(): Promise<boolean> {
  refreshInFlight ??= doRefresh().finally(() => {
    refreshInFlight = null;
  });
  return refreshInFlight;
}

// ---- request core ------------------------------------------------------------

interface RequestOptions {
  body?: unknown;
  idempotencyKey?: string;
  signal?: AbortSignal;
  retry?: boolean;
}

async function toApiError(res: Response): Promise<ApiError> {
  let code = "INTERNAL";
  let message = res.statusText || "Request failed";
  let details: unknown;
  try {
    const data: unknown = await res.json();
    if (data && typeof data === "object" && "error" in data) {
      const err = (data as { error?: { code?: string; message?: string; details?: unknown } }).error;
      if (err?.code) code = err.code;
      if (err?.message) message = err.message;
      details = err?.details;
    }
  } catch {
    /* non-JSON error body; keep the status defaults */
  }
  return new ApiError(res.status, code, message, details);
}

async function request<T>(method: string, path: string, opts: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = {};
  if (opts.body !== undefined) headers["Content-Type"] = "application/json";
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
  if (opts.idempotencyKey) headers["Idempotency-Key"] = opts.idempotencyKey;

  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers,
    credentials: "include",
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    signal: opts.signal,
  });

  if (res.status === 401 && !opts.retry && path !== "/auth/refresh") {
    const refreshed = await refreshSession();
    if (refreshed) return request<T>(method, path, { ...opts, retry: true });
    accessToken = null;
    sessionExpiredHandler();
    throw await toApiError(res);
  }

  if (!res.ok) throw await toApiError(res);

  if (res.status === 204) return undefined as T;
  const text = await res.text();
  if (!text) return undefined as T;
  return JSON.parse(text) as T;
}

export interface MutationOptions {
  idempotencyKey?: string;
  signal?: AbortSignal;
}

export const api = {
  get<T>(path: string, signal?: AbortSignal): Promise<T> {
    return request<T>("GET", path, { signal });
  },
  post<T>(path: string, body?: unknown, opts: MutationOptions = {}): Promise<T> {
    return request<T>("POST", path, { body, ...opts });
  },
  put<T>(path: string, body?: unknown, opts: MutationOptions = {}): Promise<T> {
    return request<T>("PUT", path, { body, ...opts });
  },
  patch<T>(path: string, body?: unknown, opts: MutationOptions = {}): Promise<T> {
    return request<T>("PATCH", path, { body, ...opts });
  },
  del<T>(path: string, body?: unknown, opts: MutationOptions = {}): Promise<T> {
    return request<T>("DELETE", path, { body, ...opts });
  },
};

/** Build a `?a=b&c=d` string from a record, skipping undefined/empty values. */
export function toQuery(params: Record<string, string | number | boolean | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === "") continue;
    search.set(key, String(value));
  }
  const str = search.toString();
  return str ? `?${str}` : "";
}
