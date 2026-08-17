import type { GameState } from "@/lib/db/types";

export const TURN_LOCK_STALE_MS = 20 * 60 * 1000;
export const TURN_LOCK_HEARTBEAT_MS = 30_000;

export type ProcessingLockSnapshot = Pick<
  GameState,
  | "isProcessing"
  | "processingPhase"
  | "processingTargetTurn"
  | "processingHeartbeatAt"
  | "processingStartedAt"
  | "updatedAt"
>;

export function getProcessingLockLastTouch(snapshot: ProcessingLockSnapshot): Date | null {
  return (
    snapshot.processingHeartbeatAt ?? snapshot.processingStartedAt ?? snapshot.updatedAt ?? null
  );
}

export function getProcessingLockState(snapshot: ProcessingLockSnapshot, now = new Date()) {
  const lastTouch = getProcessingLockLastTouch(snapshot);
  const staleAfterAt = lastTouch ? new Date(lastTouch.getTime() + TURN_LOCK_STALE_MS) : now;
  const retryAfterMs = lastTouch ? Math.max(0, staleAfterAt.getTime() - now.getTime()) : 0;

  return {
    lastTouch,
    staleAfterAt,
    retryAfterMs,
    isStale: !lastTouch || retryAfterMs === 0,
  };
}

/**
 * v3 Phase 7/8 fix: is a turn actively being processed right now (lock held,
 * not stale/abandoned)? Player-facing mutation routes whose fields are ALSO
 * written by the corp turn's own bulk write (unionization, strikeStartedAtTurn,
 * strikeCooldownUntilTurn on CorporateSector; treasury/approval on Union)
 * must reject during this window — the turn's write recomputes those
 * fields from a pre-mutation snapshot and would otherwise silently clobber a
 * paid-for player action with no error surfaced. See
 * docs/plans/2026-06-30-labour-handoff.md's code-review section for the bug
 * this closes. Cheaper and lower-risk than retrofitting optimistic
 * concurrency into the shared turn-processing bulk writes.
 */
export function isTurnProcessingNow(snapshot: ProcessingLockSnapshot, now = new Date()): boolean {
  if (snapshot.isProcessing !== true) return false;
  return !getProcessingLockState(snapshot, now).isStale;
}

export type CrashRecoverySnapshot = ProcessingLockSnapshot &
  Pick<GameState, "processingKind" | "currentTurn">;

/**
 * Turn-atomicity guard (issue #2815). A turn's ~20 phases each commit DB writes
 * directly, and `currentTurn` only advances after they all finish — no
 * transaction wraps the turn (turns run 36–67s over thousands of docs, past
 * Mongo's per-transaction limits). If the process dies mid-turn (OOM, the
 * worker 5-min kill, a deploy, a host crash) the lock is left held; the 20-min
 * stale takeover would otherwise re-run the SAME turn from the start and
 * double-apply every additive-income phase that already committed (fund
 * generation, corp liquidity/dividends, savings interest, bond coupons, caucus
 * tax, treasury) — persistent, economy-wide money creation.
 *
 * Returns true when a stale lock belongs to a turn that had already progressed
 * past bootstrap (so phases may have committed). The caller then consumes the
 * turn number instead of re-executing it, leaving the crashed turn partially
 * applied rather than duplicated. A turn stranded at bootstrap applied nothing,
 * so this returns false and the turn is safely (and losslessly) re-run.
 *
 * `currentPhase` (the phase the runtime durably flushes as it runs) is the
 * progress signal. This is a pure decision — the caller re-checks the freshly
 * locked state before acting so a concurrent completion can't be double-counted.
 */
export function shouldRecoverCrashedTurn(
  snapshot: CrashRecoverySnapshot,
  now = new Date()
): boolean {
  if (snapshot.isProcessing !== true) return false; // no lock held → nothing to recover
  if (!getProcessingLockState(snapshot, now).isStale) return false; // healthy in-flight
  if (snapshot.processingKind !== "turn") return false; // some other processing kind
  const target = snapshot.processingTargetTurn;
  if (typeof target !== "number" || target !== snapshot.currentTurn + 1) return false;
  const phase = snapshot.processingPhase;
  return !!phase && phase !== "turn_bootstrap";
}
