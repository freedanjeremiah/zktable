// Browser-session seat tokens (M8.4): an httpOnly cookie identifies a
// browser so human seats can be bound to it. Not authentication — just
// enough to stop "anyone with the matchId can move any seat"
// (the contract-level guarantee is M8.1's require_auth; this is the
// API-layer complement for non-wallet seats).

import { randomUUID } from "node:crypto";
import type { NextResponse } from "next/server";

export const SESSION_COOKIE = "zktable_session";

/** Reads the session token from a request's Cookie header, if present. */
export function readSessionToken(request: Request): string | undefined {
  const header = request.headers.get("cookie");
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === SESSION_COOKIE) return rest.join("=") || undefined;
  }
  return undefined;
}

/**
 * Returns the request's session token, minting one if absent. When minted,
 * the caller must pass the response through `attachSessionCookie` so the
 * browser keeps it.
 */
export function getOrCreateSessionToken(request: Request): { token: string; isNew: boolean } {
  const existing = readSessionToken(request);
  if (existing) return { token: existing, isNew: false };
  return { token: randomUUID(), isNew: true };
}

export function attachSessionCookie<T extends NextResponse>(response: T, token: string): T {
  response.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
  return response;
}
