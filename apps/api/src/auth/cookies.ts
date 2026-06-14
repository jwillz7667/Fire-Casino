import { type CookieOptions } from "express";
import { type Env } from "@aureus/shared";

export const REFRESH_COOKIE = "fc_refresh";

/** httpOnly, secure (prod), sameSite=lax cookie for the rotating refresh token. */
export function refreshCookieOptions(env: Env): CookieOptions {
  return {
    httpOnly: true,
    secure: env.COOKIE_SECURE,
    sameSite: "lax",
    domain: env.COOKIE_DOMAIN,
    path: "/api/v1/auth",
    maxAge: env.JWT_REFRESH_TTL * 1000,
  };
}
