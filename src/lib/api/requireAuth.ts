/**
 * Require auth for API route handlers.
 * Use at the start of route handlers that need authentication.
 */
import crypto from "crypto";
import { NextResponse } from "next/server";
import { clearAuthCookie, getAuthUser, getAuthUserWithCharacter } from "@/lib/auth";
import { unauthorized, forbidden } from "@/lib/api/errors";
import { assertSameOrigin } from "@/lib/api/assertSameOrigin";
import { logApiAccess } from "@/lib/api/accessLog";
import { setUserContext, setAuditRequestContext } from "@/lib/observability/context";
import { setGameContext } from "@/lib/observability/gameContext";
import { getGameState } from "@/lib/gameState";
import type { AuthUser, AuthUserWithCharacter } from "@/lib/auth";
import type { Character } from "@/lib/db/types";

/**
 * Mint a per-request `traceId` and stamp it + the resolved actor into the
 * audit context (`src/lib/observability/context.ts`, AsyncLocalStorage) so
 * `recordAudit`/`recordAuditBulk` (src/lib/audit/recordAudit.ts, Phase 1)
 * can default `traceId`/`actor` for envelopes written during this request
 * without every call site threading them through. Never throws — a failure
 * here must not break auth. See forensics/alt-detection plan §3.1.
 */
function stampAuditRequestContext(user: AuthUser & { character?: Character }): void {
  try {
    const characterId = user.character?._id
      ? String(user.character._id)
      : (user.activeCharacterId ?? undefined);
    setAuditRequestContext(crypto.randomUUID(), {
      kind: user.isAdmin ? "admin" : "player",
      userId: user.userId,
      characterId,
      name: user.username,
      role: user.role,
    });
  } catch {
    // Observability must never break the request.
  }
}

export type AuthResult =
  { ok: true; user: AuthUserWithCharacter } | { ok: false; response: NextResponse };

export type AuthWithCharacterResult =
  | { ok: true; user: AuthUserWithCharacter & { hasCharacter: true; character: Character } }
  | { ok: false; response: NextResponse };

export type BasicAuthResult = { ok: true; user: AuthUser } | { ok: false; response: NextResponse };

/**
 * Fetch the current turn and tag the Sentry scope with it, plus the
 * character's office if available. Failures are swallowed — observability
 * must never break auth.
 */
async function applyGameContext(user: AuthUserWithCharacter): Promise<void> {
  try {
    const gs = await getGameState();
    const turn = gs?.currentTurn ?? 0;
    setGameContext(turn, user.character?.currentOffice);
  } catch {
    // Don't let a DB failure in game-context tagging break the request.
  }
}

/**
 * Require authenticated user for API routes.
 * Returns user with optional character data. Use requireAuthWithCharacter if character is required.
 * Returns 401 if not authenticated.
 *
 * @example
 * const auth = await requireAuth();
 * if (!auth.ok) return auth.response;
 * // auth.user is now available (may or may not have character)
 */
export async function requireAuth(): Promise<AuthResult> {
  const user = await getAuthUserWithCharacter();
  if (!user) {
    await clearAuthCookie("require_auth:user_null");
    return { ok: false, response: NextResponse.json(unauthorized().toJson(), { status: 401 }) };
  }
  setUserContext(user);
  stampAuditRequestContext(user);
  await applyGameContext(user);
  return { ok: true, user };
}

/**
 * Require authenticated user (basic, no character lookup).
 * Faster than requireAuth when character data is not needed.
 * Returns 401 if not authenticated.
 *
 * @example
 * const auth = await requireBasicAuth();
 * if (!auth.ok) return auth.response;
 * // auth.user has userId, username, email, role, isAdmin
 */
export async function requireBasicAuth(): Promise<BasicAuthResult> {
  const user = await getAuthUser();
  if (!user) {
    await clearAuthCookie("require_basic_auth:user_null");
    return { ok: false, response: NextResponse.json(unauthorized().toJson(), { status: 401 }) };
  }
  setUserContext(user);
  stampAuditRequestContext(user);
  return { ok: true, user };
}

function botTokenRejected(): { ok: false; response: NextResponse } {
  return {
    ok: false,
    response: NextResponse.json(
      forbidden("Automated access is not permitted for this endpoint.").toJson(),
      { status: 403 }
    ),
  };
}

/**
 * The header the playtest harness stamps on every request, carrying its run id.
 *
 * Declaring automation is not the same as being allowed to automate. The header
 * only ever *labels* a caller; whether it may act is decided by the character it
 * resolves to, below.
 */
export const SYNTHETIC_RUN_HEADER = "X-Synthetic-Run";

/**
 * Decide what a claimed synthetic run means for this request.
 *
 * A valid session with no bot header already satisfies these guards, so an
 * automated caller was previously indistinguishable from a player: it could act
 * freely and its actions were unattributable afterwards. The header closes that
 * by making automation declare itself.
 *
 * It is checked, not trusted. A request claiming a run against a character that
 * is not marked synthetic is refused outright rather than merely unlabelled —
 * otherwise the header would be a way for a real account to opt out of being
 * treated as a person, which is the opposite of the point.
 */
function synthetic(
  request: Request,
  character: { isSynthetic?: boolean } | null | undefined
): { runId: string | null; rejected: boolean } {
  const runId = request.headers.get(SYNTHETIC_RUN_HEADER);
  if (!runId) return { runId: null, rejected: false };
  return { runId, rejected: character?.isSynthetic !== true };
}

/**
 * Require a human browser session — rejects any request carrying an X-Bot-Token header.
 * Use on action endpoints where automation is explicitly prohibited (attack, political actions, endorsements).
 * Fund-transfer and forex endpoints may remain bot-accessible; use requireBasicAuth() there instead.
 *
 * @example
 * const auth = await requireHumanSession(request);
 * if (!auth.ok) return auth.response;
 */
export async function requireHumanSession(request: Request): Promise<BasicAuthResult> {
  if (request.headers.get("X-Bot-Token")) return botTokenRejected();
  const crossOrigin = assertSameOrigin(request);
  if (crossOrigin) return { ok: false, response: crossOrigin };
  const auth = await requireBasicAuth();
  if (!auth.ok) return auth;

  // Only pay for the character lookup when a run is actually claimed, so
  // ordinary player traffic costs exactly what it did before.
  const runId = request.headers.get(SYNTHETIC_RUN_HEADER);
  if (runId) {
    const withCharacter = await getAuthUserWithCharacter();
    if (synthetic(request, withCharacter?.character).rejected) return botTokenRejected();
  }

  logApiAccess(request, {
    authType: runId ? "synthetic" : "session",
    userId: auth.user.userId,
    syntheticRunId: runId ?? undefined,
  });
  return auth;
}

/**
 * Like requireHumanSession but also requires an active character.
 * Use on action endpoints that need character data and must reject automation.
 *
 * @example
 * const auth = await requireHumanSessionWithCharacter(request);
 * if (!auth.ok) return auth.response;
 */
export async function requireHumanSessionWithCharacter(
  request: Request
): Promise<AuthWithCharacterResult> {
  if (request.headers.get("X-Bot-Token")) return botTokenRejected();
  const crossOrigin = assertSameOrigin(request);
  if (crossOrigin) return { ok: false, response: crossOrigin };
  const auth = await requireAuthWithCharacter();
  if (!auth.ok) return auth;

  // The character is already resolved here, so the check is free.
  const claim = synthetic(request, auth.user.character);
  if (claim.rejected) return botTokenRejected();

  logApiAccess(request, {
    authType: claim.runId ? "synthetic" : "session",
    userId: auth.user.userId,
    syntheticRunId: claim.runId ?? undefined,
  });
  return auth;
}

/**
 * Require authenticated user with a character for API routes.
 * Returns 401 if not authenticated or no character exists.
 *
 * @example
 * const auth = await requireAuthWithCharacter();
 * if (!auth.ok) return auth.response;
 * // auth.user.character is guaranteed to exist
 */
export async function requireAuthWithCharacter(): Promise<AuthWithCharacterResult> {
  const user = await getAuthUserWithCharacter();
  if (!user || !user.hasCharacter || !user.character) {
    if (!user) {
      await clearAuthCookie("require_auth_with_character:user_null");
    }
    return {
      ok: false,
      response: NextResponse.json(unauthorized("Authentication with character required").toJson(), {
        status: 401,
      }),
    };
  }
  setUserContext(user);
  stampAuditRequestContext(user);
  await applyGameContext(user);
  return {
    ok: true,
    user: user as AuthUserWithCharacter & { hasCharacter: true; character: Character },
  };
}
