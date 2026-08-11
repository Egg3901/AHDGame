/**
 * Request-scoped observability context.
 *
 * The @sentry/nextjs SDK gives each incoming request its own isolation scope,
 * so user/tag/breadcrumb state set here is request-local and never leaks across
 * concurrent requests. These helpers turn anonymous "something threw" events
 * into attributed "X threw for user Y while doing Z" events — the single
 * biggest force-multiplier for diagnosing production issues without source maps.
 */
import { AsyncLocalStorage } from "async_hooks";
import * as Sentry from "@sentry/nextjs";
import type { AuthUser } from "@/lib/auth";

type AttributableUser = Pick<AuthUser, "userId" | "username" | "role"> &
  Partial<Pick<AuthUser, "isAdmin" | "isModerator" | "activeCharacterId">> & {
    character?: { _id?: { toString(): string }; countryId?: string };
  };

/**
 * Actor identity carried alongside a request/turn-phase `traceId` — mirrors
 * (a trimmed view of) `ActionAuditActor` (`src/lib/db/types/actionAuditLog.ts`)
 * so `recordAudit` (`src/lib/audit/recordAudit.ts`) can default `actor` from
 * context instead of every call site threading it through.
 */
export interface AuditActorContext {
  kind: "player" | "npp" | "system" | "admin";
  userId?: string;
  characterId?: string;
  name?: string;
  role?: string;
}

/** The audit correlation context carried for the life of one request or turn phase. */
export interface AuditRequestContext {
  traceId: string;
  actor?: AuditActorContext;
  /** Mutable per-trace counter — `nextSeq()` hands out an incrementing `seq`
   * for `recordAudit` envelopes written within this trace. */
  nextSeq: () => number;
}

const auditContextStorage = new AsyncLocalStorage<AuditRequestContext>();

function makeContext(traceId: string, actor?: AuditActorContext): AuditRequestContext {
  let seq = 0;
  return {
    traceId,
    actor,
    nextSeq: () => seq++,
  };
}

/**
 * Mint a per-request `traceId` and stamp it (+ the resolved actor) into the
 * audit context. Called from the auth guards (`src/lib/api/requireAuth.ts`)
 * alongside {@link setUserContext}. Uses `enterWith` (not `run`) because the
 * guard returns normally and the rest of the request handler continues
 * outside any wrapping callback — `enterWith` persists the store through the
 * remainder of the current async execution chain, which is exactly that
 * continuation.
 */
export function setAuditRequestContext(traceId: string, actor?: AuditActorContext): void {
  auditContextStorage.enterWith(makeContext(traceId, actor));
}

/**
 * Run `fn` inside a fresh audit context — for callers that DO control a
 * wrapping scope (e.g. a turn phase runner), where `AsyncLocalStorage.run`
 * is the more precise primitive. Not used by the request path (see
 * {@link setAuditRequestContext}), but exposed so turn-phase instrumentation
 * (traceId convention `"turn:<n>:<phase>"`) can adopt it without re-deriving
 * this wiring.
 */
export function runInAuditContext<T>(traceId: string, fn: () => T, actor?: AuditActorContext): T {
  return auditContextStorage.run(makeContext(traceId, actor), fn);
}

/** Read the current audit context, if any. `recordAudit` falls back to this
 * when a caller doesn't pass `traceId`/`actor`/`seq` explicitly. */
export function getAuditRequestContext(): AuditRequestContext | undefined {
  return auditContextStorage.getStore();
}

/** Build the turn-phase trace id convention (`"turn:<n>:<phase>"`), shared so
 * Phase 1 and the later turn-phase instrumentation (T2.7) agree on the format. */
export function turnPhaseTraceId(turn: number, phase: string): string {
  return `turn:${turn}:${phase}`;
}

/**
 * Attribute the current Sentry scope to an authenticated user. Called from the
 * auth guards so every subsequent error, log, and breadcrumb in the request
 * carries who triggered it. Username (a game handle, not PII like email) is
 * included deliberately for triage; email is never set.
 */
export function setUserContext(user: AttributableUser): void {
  Sentry.setUser({ id: user.userId, username: user.username });
  Sentry.setTags({
    "user.role": user.role,
    "user.isAdmin": user.isAdmin === true,
    "user.isModerator": user.isModerator === true,
  });
  const characterId = user.character?._id?.toString() ?? user.activeCharacterId ?? undefined;
  if (characterId) Sentry.setTag("character.id", characterId);
  if (user.character?.countryId) Sentry.setTag("country.id", user.character.countryId);
}

/**
 * Run a fire-and-forget promise without losing its rejection.
 *
 * Replaces bare `void asyncCall()` and `.catch(() => {})` for background
 * side-effects (ledger writes, notifications, webhooks, snapshots). A swallowed
 * rejection there means the side-effect silently never happened — drifted
 * ledgers, missed notifications — with zero alert. This captures the failure
 * with enough context to know which side-effect dropped, while still not
 * blocking or failing the main request.
 */
export function voidWithCapture(
  promise: Promise<unknown>,
  context: {
    tags?: Record<string, string | number | boolean>;
    extra?: Record<string, unknown>;
    level?: Sentry.SeverityLevel;
  } = {}
): void {
  void Promise.resolve(promise).catch((error: unknown) => {
    Sentry.captureException(error, {
      level: context.level ?? "error",
      tags: context.tags,
      extra: context.extra,
    });
  });
}

/**
 * Run a compensating refund/reversal after a debit has already committed, and
 * if the refund ITSELF fails, capture at `fatal` with a `failure:
 * refund_after_debit` tag plus the account/amount. That second failure is the
 * real money-loss event — the buyer is debited, got nothing, and was not
 * refunded — and must never be swallowed. Does not rethrow: callers rethrow the
 * original delivery error so the request still surfaces as a 500.
 */
export async function refundOrCapture(
  refund: () => Promise<unknown>,
  context: {
    tags?: Record<string, string | number | boolean>;
    extra?: Record<string, unknown>;
  }
): Promise<void> {
  try {
    await refund();
  } catch (refundError) {
    Sentry.captureException(refundError, {
      level: "fatal",
      tags: { failure: "refund_after_debit", ...context.tags },
      extra: context.extra,
    });
  }
}

/**
 * Wrap a side-effect-bearing async function so a rejection is captured rather
 * than swallowed, returning a fallback. Use inside try/catch-free best-effort
 * blocks (audit-log writes, cache refreshes) where the main flow must continue.
 */
export async function runWithCapture<T>(
  fn: () => Promise<T>,
  context: {
    tags?: Record<string, string | number | boolean>;
    extra?: Record<string, unknown>;
    level?: Sentry.SeverityLevel;
  },
  fallback?: T
): Promise<T | undefined> {
  try {
    return await fn();
  } catch (error) {
    Sentry.captureException(error, {
      level: context.level ?? "error",
      tags: context.tags,
      extra: context.extra,
    });
    return fallback;
  }
}
