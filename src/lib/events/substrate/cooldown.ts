import { ObjectId } from "mongodb";
import type { Db } from "mongodb";
import { getEventCooldownLedgerCollection } from "@/lib/db/collections/eventCooldownLedger";
import type { EventCooldownLedger } from "@/lib/db/types/events";
import { seededCooldownTurns } from "./rng";

export const PREE_COOLDOWN_TURNS_MIN = 10;
export const PREE_COOLDOWN_TURNS_MAX = 20;

/** Country-scope events fire far less often than character PREE — wider default band. */
export const COUNTRY_COOLDOWN_TURNS_MIN = 6;
export const COUNTRY_COOLDOWN_TURNS_MAX = 16;

export function isCharacterEligibleForOffer(
  ledger: EventCooldownLedger | null,
  currentTurn: number
): boolean {
  if (!ledger) {
    return true;
  }
  return currentTurn >= ledger.nextEligibleTurn;
}

export async function updateCharacterCooldownLedger(
  db: Db,
  scopeId: ObjectId,
  currentTurn: number,
  cooldownTurns?: number
): Promise<void> {
  const spacing =
    cooldownTurns ??
    seededCooldownTurns(
      scopeId.toHexString(),
      currentTurn,
      PREE_COOLDOWN_TURNS_MIN,
      PREE_COOLDOWN_TURNS_MAX
    );
  const coll = getEventCooldownLedgerCollection(db);
  const now = new Date();
  await coll.updateOne(
    { scope: "character", scopeId },
    {
      $set: {
        scope: "character",
        scopeId,
        lastExpiredAtTurn: currentTurn,
        nextEligibleTurn: currentTurn + spacing,
        updatedAt: now,
      },
      $setOnInsert: {
        _id: scopeId,
        perKindCooldowns: {},
      },
    },
    { upsert: true }
  );
}

/**
 * Country-scope equivalent of {@link updateCharacterCooldownLedger}. `scopeId`
 * is the hashed country lookup key from {@link countryScopeId} (see that
 * module's doc comment for why countries don't have a natural ObjectId).
 */
/**
 * Reads the last-fired turn for `kind` from a country-scope ledger, or
 * `undefined` if the definition has never fired for this country (the
 * window scheduler treats that as immediately eligible).
 */
export function getLastFiredTurn(
  ledger: Pick<EventCooldownLedger, "lastFiredTurnByKind"> | null,
  kind: string
): number | undefined {
  return ledger?.lastFiredTurnByKind?.[kind];
}

/**
 * Records that a scheduled country-scope definition fired this turn — the
 * scheduler's own record, distinct from {@link updateCountryCooldownLedger}'s
 * `nextEligibleTurn` (which PREE-style random weighting does not use for
 * scheduled definitions). Upserts the same ledger document scheduled and
 * random country events share (single collection, extended not duplicated).
 */
export async function recordScheduledCountryFire(
  db: Db,
  scopeId: ObjectId,
  kind: string,
  currentTurn: number
): Promise<void> {
  const coll = getEventCooldownLedgerCollection(db);
  const now = new Date();
  await coll.updateOne(
    { scope: "country", scopeId },
    {
      $set: {
        scope: "country",
        scopeId,
        [`lastFiredTurnByKind.${kind}`]: currentTurn,
        updatedAt: now,
      },
      $setOnInsert: {
        _id: scopeId,
        lastExpiredAtTurn: currentTurn,
        nextEligibleTurn: currentTurn,
        perKindCooldowns: {},
      },
    },
    { upsert: true }
  );
}

export async function updateCountryCooldownLedger(
  db: Db,
  scopeId: ObjectId,
  currentTurn: number,
  cooldownTurns?: number
): Promise<void> {
  const spacing =
    cooldownTurns ??
    seededCooldownTurns(
      scopeId.toHexString(),
      currentTurn,
      COUNTRY_COOLDOWN_TURNS_MIN,
      COUNTRY_COOLDOWN_TURNS_MAX
    );
  const coll = getEventCooldownLedgerCollection(db);
  const now = new Date();
  await coll.updateOne(
    { scope: "country", scopeId },
    {
      $set: {
        scope: "country",
        scopeId,
        lastExpiredAtTurn: currentTurn,
        nextEligibleTurn: currentTurn + spacing,
        updatedAt: now,
      },
      $setOnInsert: {
        _id: scopeId,
        perKindCooldowns: {},
      },
    },
    { upsert: true }
  );
}
