import { getAuthCookieOptions } from "@/lib/auth";
import { CHARACTER_GATE_COOKIE } from "./characterGate";

/**
 * Minimal cookie writer shape — satisfied by the `next/headers` cookie store
 * and by a `NextResponse.cookies` instance.
 */
interface CookieSetter {
  set(name: string, value: string, options: Record<string, unknown>): void;
}

/**
 * Set or clear the character-creation hint cookie read by `middleware.ts`.
 *
 * Reuses the auth-cookie options (domain/secure/sameSite/path/httpOnly, 7-day
 * maxAge) so the hint shares the auth cookie's scope and is torn down on the
 * same domains. This module imports `@/lib/auth` (Node-only) and therefore must
 * never be imported by the edge middleware — middleware only reads the cookie.
 */
export async function setCharacterGateCookie(
  store: CookieSetter,
  needsCharacter: boolean
): Promise<void> {
  const options = await getAuthCookieOptions();
  if (needsCharacter) {
    store.set(CHARACTER_GATE_COOKIE, "1", options);
  } else {
    store.set(CHARACTER_GATE_COOKIE, "", { ...options, maxAge: 0 });
  }
}
