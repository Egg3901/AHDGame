/**
 * Broadcast events — shared historic moments (the moon landing, the Wall
 * coming down) offered to EVERY eligible character at once instead of the
 * usual one-random-event-per-character weighted pick.
 *
 * Mechanics:
 * - A definition opts in with `broadcast: "country" | "global"` plus a
 *   `minYear`/`maxYear` window (era gating) — the broadcast fires on the
 *   first turn the in-game year is inside the window.
 * - "country" broadcasts additionally respect `requiresCountryIds`: only
 *   characters of those nations receive the moment (e.g. a US-only national
 *   tragedy). "global" reaches every country.
 * - Each broadcast fires AT MOST ONCE per world. Fired kinds are recorded in
 *   the shared event cooldown ledger under a synthetic country scope keyed
 *   by {@link broadcastScopeId}, reusing the scheduler's
 *   `lastFiredTurnByKind` machinery (no new collections).
 * - Only one broadcast fires per turn; if several become due in the same
 *   year the rest stay due and fire on following turns.
 * - Broadcast offers bypass the per-character global spacing cooldown (the
 *   moment shouldn't skip people just because they recently had jury duty).
 *   A pending event does NOT block a broadcast either: it is superseded —
 *   auto-resolved on its default option (same semantics as a timeout sweep)
 *   so the historic moment always lands.
 * - Broadcast definitions never enter the normal weighted pool (see
 *   weighting.ts), so `baseWeight` is unused for them.
 */
import type { Db } from "mongodb";
import type { EventDefinition } from "@/lib/db/types/events";
import type { EventCooldownLedger } from "@/lib/db/types/events";
import { getEventCooldownLedgerCollection } from "@/lib/db/collections/eventCooldownLedger";
import { countryScopeId } from "@/lib/events/substrate/countryScopeId";
import { getLastFiredTurn, recordScheduledCountryFire } from "@/lib/events/substrate/cooldown";
import { isWithinYearWindow } from "@/lib/events/substrate/yearWindow";
import { getDefaultOptionId, getEventHandler } from "@/lib/events/substrate/registry";
import { EventNotResolvableError, resolveEvent } from "@/lib/events/substrate/resolve";
import type { EventInstance } from "@/lib/db/types/events";
import type { CharacterEventContext } from "./eligibility";

/** Synthetic ledger key for broadcast fired-markers (scope "country", key "broadcast"). */
export function broadcastScopeId() {
  return countryScopeId("broadcast");
}

export async function loadBroadcastLedger(db: Db): Promise<EventCooldownLedger | null> {
  return getEventCooldownLedgerCollection(db).findOne({
    scope: "country",
    scopeId: broadcastScopeId(),
  });
}

/**
 * Returns the first approved broadcast definition whose year window contains
 * `currentYear` and which has never fired (and has a registered handler), or
 * null. Array order decides precedence when several are due the same year.
 */
export function findDueBroadcast(
  definitions: EventDefinition[],
  ledger: EventCooldownLedger | null,
  currentYear: number | undefined
): EventDefinition | null {
  if (currentYear == null) {
    return null;
  }
  for (const definition of definitions) {
    if (!definition.broadcast) {
      continue;
    }
    if (!isWithinYearWindow(definition, currentYear)) {
      continue;
    }
    if (getLastFiredTurn(ledger, definition.kind) !== undefined) {
      continue;
    }
    if (!getEventHandler(definition.kind)) {
      continue;
    }
    return definition;
  }
  return null;
}

export async function markBroadcastFired(db: Db, kind: string, currentTurn: number): Promise<void> {
  await recordScheduledCountryFire(db, broadcastScopeId(), kind, currentTurn);
}

/**
 * Clears a character's pending event so a broadcast can take its slot: the
 * pending instance is auto-resolved on its default option with timeout
 * semantics (default effects apply, marked "expired"). Returns true when the
 * slot is free afterward (or already was, e.g. a concurrent resolution),
 * false when the pending event could not be superseded.
 */
export async function supersedePendingEventForBroadcast(
  db: Db,
  instance: EventInstance,
  currentTurn: number
): Promise<boolean> {
  const defaultOptionId = getDefaultOptionId(instance.kind);
  if (!defaultOptionId) {
    return false;
  }
  try {
    await resolveEvent(db, instance._id, defaultOptionId, "timeout", currentTurn);
    return true;
  } catch (err) {
    // Already resolved concurrently — the slot is free, offer can proceed.
    if (err instanceof EventNotResolvableError) {
      return true;
    }
    return false;
  }
}

/** Does this broadcast reach this character? "global" reaches everyone; "country" checks requiresCountryIds. */
export function broadcastMatchesCharacter(
  definition: EventDefinition,
  characterCtx: CharacterEventContext
): boolean {
  if (definition.broadcast === "global") {
    return true;
  }
  if (definition.broadcast === "country") {
    return (
      !definition.requiresCountryIds ||
      definition.requiresCountryIds.includes(characterCtx.countryId)
    );
  }
  return false;
}
