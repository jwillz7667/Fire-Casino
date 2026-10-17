import { type CookieOptions } from "express";
import { type Env } from "@aureus/shared";
import { type Audience } from "../common/auth/principal";

export const LEGACY_REFRESH_COOKIE = "fc_refresh";
export const REFRESH_COOKIES = {
  operator: "fc_operator_refresh",
  player: "fc_player_refresh",
} as const;

export function refreshCookieName(audience: Audience): string {
  return REFRESH_COOKIES[audience];
}

/**
 * httpOnly cookie for the rotating refresh token. SameSite + domain are env-
 * driven so it works both same-domain (lax, shared parent domain) and cross-site
 * (none + secure, frontends on Vercel calling the API on Railway). SameSite=None
 * is invalid without Secure, so it forces Secure on. A "localhost" or empty
 * COOKIE_DOMAIN makes the cookie host-only — correct in dev and in the cross-site
 * prod case; set it to ".goldwavecasino.xyz" only when the API and frontends
 * share that registrable domain.
 */
export function refreshCookieOptions(env: Env): CookieOptions {
  const sameSite = env.COOKIE_SAMESITE;
  const domain =
    env.COOKIE_DOMAIN && env.COOKIE_DOMAIN !== "localhost" ? env.COOKIE_DOMAIN : undefined;
  return {
    httpOnly: true,
    secure: env.COOKIE_SECURE || sameSite === "none",
    sameSite,
    domain,
    path: "/api/v1/auth",
    maxAge: env.JWT_REFRESH_TTL * 1000,
  };
}
