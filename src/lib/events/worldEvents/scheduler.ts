/**
 * World Events v1 Phase 1 — deterministic scheduling math. Pure functions,
 * no DB access, so firing logic is unit-testable without mocks. Never uses
 * Date.now()/Math.random — everything is derived from turn number + stable
 * hashes (plan §7: "sim-reproducible").
 */
import type { EventSchedule } from "@/lib/db/types/events";
import { hashToUint32 } from "@/lib/events/substrate/rng";

/**
 * Recurring schedule firing check: fires whenever `(turn - offsetTurns)` is
 * an exact multiple of `everyTurns`. JS `%` can return negative results for
 * negative operands (only possible pre-genesis, but guarded for safety), so
 * the result is normalized back into `[0, everyTurns)` before comparing.
 */
export function isRecurringDue(
  turn: number,
  schedule: Pick<Extract<EventSchedule, { kind: "recurring" }>, "everyTurns" | "offsetTurns">
): boolean {
  if (schedule.everyTurns <= 0) {
    return false;
  }
  const remainder = (turn - schedule.offsetTurns) % schedule.everyTurns;
  const normalized =
    ((remainder % schedule.everyTurns) + schedule.everyTurns) % schedule.everyTurns;
  return normalized === 0;
}

/**
 * Deterministic gap (in turns) until a "window" schedule's next fire, derived
 * from hash(countryId, definitionKind, lastFiredTurn) — same inputs always
 * produce the same gap; a different `lastFiredTurn` produces a different
 * (still deterministic) gap. This is the core of window-schedule determinism:
 * no random draw, no wall clock, fully replayable from turn history.
 */
export function windowGapTurns(
  countryId: string,
  definitionKind: string,
  lastFiredTurn: number,
  schedule: Pick<Extract<EventSchedule, { kind: "window" }>, "minGapTurns" | "maxGapTurns">
): number {
  if (schedule.minGapTurns > schedule.maxGapTurns) {
    throw new Error("windowGapTurns: minGapTurns cannot exceed maxGapTurns");
  }
  const span = schedule.maxGapTurns - schedule.minGapTurns + 1;
  const seed = hashToUint32(`worldEventSchedule:${countryId}:${definitionKind}:${lastFiredTurn}`);
  return schedule.minGapTurns + (seed % span);
}

/**
 * Window schedule firing check. A definition that has never fired for this
 * country (`lastFiredTurn === undefined`) is immediately eligible — there is
 * no prior fire to hash against, and gating a country out of its first-ever
 * occurrence indefinitely would be a silent starvation bug, not a feature.
 */
export function isWindowDue(
  turn: number,
  countryId: string,
  definitionKind: string,
  lastFiredTurn: number | undefined,
  schedule: Pick<Extract<EventSchedule, { kind: "window" }>, "minGapTurns" | "maxGapTurns">
): boolean {
  if (lastFiredTurn === undefined) {
    return true;
  }
  const gap = windowGapTurns(countryId, definitionKind, lastFiredTurn, schedule);
  return turn >= lastFiredTurn + gap;
}

/**
 * Single entry point covering both schedule kinds — the driver calls this
 * without needing to branch on `schedule.kind` itself.
 */
export function isScheduleDue(
  turn: number,
  countryId: string,
  definitionKind: string,
  lastFiredTurn: number | undefined,
  schedule: EventSchedule
): boolean {
  if (schedule.kind === "recurring") {
    return isRecurringDue(turn, schedule);
  }
  return isWindowDue(turn, countryId, definitionKind, lastFiredTurn, schedule);
}
