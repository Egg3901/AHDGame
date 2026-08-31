import { ObjectId } from "mongodb";
import type { Db } from "mongodb";
import { getCountryModifiersCollection } from "@/lib/db/collections/countryModifiers";
import type {
  CountryModifier,
  SectorDemandCountryModifier,
  WarEmergencyMitigationModifier,
} from "@/lib/db/types/events";

/**
 * Write a temporary `sectorDemandModifier` effect. Expires lazily by turn
 * number — `getActiveSectorDemandModifierPct` filters on `expiresAtTurn` at
 * read time rather than requiring a delete sweep, so a missed cleanup turn
 * can never leave a stale modifier silently active. `sweepExpiredCountryModifiers`
 * still runs per-turn to keep the collection from growing unbounded.
 */
export async function writeSectorDemandModifier(
  db: Db,
  input: {
    countryId: string;
    sectorType: string;
    pct: number;
    durationTurns: number;
    appliedAtTurn: number;
    sourceInstanceId?: ObjectId;
  }
): Promise<void> {
  const doc: CountryModifier = {
    _id: new ObjectId(),
    countryId: input.countryId,
    kind: "sectorDemandModifier",
    sectorType: input.sectorType,
    pct: input.pct,
    appliedAtTurn: input.appliedAtTurn,
    expiresAtTurn: input.appliedAtTurn + Math.max(0, input.durationTurns),
    sourceInstanceId: input.sourceInstanceId,
    createdAt: new Date(),
  };
  await getCountryModifiersCollection(db).insertOne(doc);
}

/** Write temporary demand for a sector's outputs, affecting its seller margin. */
export async function writeSectorOutputDemandModifier(
  db: Db,
  input: {
    countryId: string;
    sectorType: string;
    pct: number;
    durationTurns: number;
    appliedAtTurn: number;
    sourceInstanceId?: ObjectId;
  }
): Promise<void> {
  const doc: CountryModifier = {
    _id: new ObjectId(),
    countryId: input.countryId,
    kind: "sectorOutputDemandModifier",
    sectorType: input.sectorType,
    pct: input.pct,
    appliedAtTurn: input.appliedAtTurn,
    expiresAtTurn: input.appliedAtTurn + Math.max(0, input.durationTurns),
    sourceInstanceId: input.sourceInstanceId,
    createdAt: new Date(),
  };
  await getCountryModifiersCollection(db).insertOne(doc);
}

/** Country measures can slow domestic crisis recurrence, never suppress it. */
export async function writeWarEmergencyMitigation(
  db: Db,
  input: {
    countryId: string;
    pct: number;
    durationTurns: number;
    appliedAtTurn: number;
    sourceInstanceId?: ObjectId;
  }
): Promise<void> {
  const doc: CountryModifier = {
    _id: new ObjectId(),
    countryId: input.countryId,
    kind: "warEmergencyMitigation",
    pct: Math.max(0, input.pct),
    appliedAtTurn: input.appliedAtTurn,
    expiresAtTurn: input.appliedAtTurn + Math.max(0, input.durationTurns),
    sourceInstanceId: input.sourceInstanceId,
    createdAt: new Date(),
  };
  await getCountryModifiersCollection(db).insertOne(doc);
}

/**
 * Sum of active `sectorDemandModifier` pct values for a country/sector at
 * `currentTurn`. Pure over the loaded docs so scheduling math is unit
 * testable without a DB.
 */
export function sumActiveSectorDemandModifierPct(
  modifiers: Pick<SectorDemandCountryModifier, "sectorType" | "pct" | "expiresAtTurn">[],
  sectorType: string,
  currentTurn: number
): number {
  return modifiers
    .filter((m) => m.sectorType === sectorType && m.expiresAtTurn > currentTurn)
    .reduce((sum, m) => sum + m.pct, 0);
}

export const WAR_EMERGENCY_MITIGATION_CAP_PCT = 45;

export function sumActiveWarEmergencyMitigationPct(
  modifiers: Pick<WarEmergencyMitigationModifier, "pct" | "expiresAtTurn">[],
  currentTurn: number
): number {
  const total = modifiers
    .filter((modifier) => modifier.expiresAtTurn > currentTurn)
    .reduce((sum, modifier) => sum + Math.max(0, modifier.pct), 0);
  return Math.min(WAR_EMERGENCY_MITIGATION_CAP_PCT, total);
}

/** One query for the scheduler's full country loop. */
export async function loadActiveWarEmergencyMitigationPctMap(
  db: Db,
  currentTurn: number
): Promise<Map<string, number>> {
  const modifiers = await getCountryModifiersCollection(db)
    .find({ kind: "warEmergencyMitigation", expiresAtTurn: { $gt: currentTurn } })
    .toArray();
  const byCountry = new Map<string, number>();
  for (const modifier of modifiers) {
    if (modifier.kind !== "warEmergencyMitigation") continue;
    byCountry.set(modifier.countryId, (byCountry.get(modifier.countryId) ?? 0) + modifier.pct);
  }
  for (const [countryId, pct] of byCountry) {
    byCountry.set(countryId, Math.min(WAR_EMERGENCY_MITIGATION_CAP_PCT, Math.max(0, pct)));
  }
  return byCountry;
}

/**
 * Loads active sectorDemandModifier docs for a country and returns the summed
 * pct for `sectorType`. Consumption point for the commodity engine (Phase 1+
 * wires this into `computeRawSupplyDemand`'s per-sector-type demand math —
 * that function currently aggregates globally/by-state with no countryId
 * parameter, so full wiring is deferred; see Phase 0 PR notes).
 */
export async function getActiveSectorDemandModifierPct(
  db: Db,
  countryId: string,
  sectorType: string,
  currentTurn: number
): Promise<number> {
  const modifiers = await getCountryModifiersCollection(db)
    .find({
      countryId,
      kind: "sectorDemandModifier",
      sectorType,
      expiresAtTurn: { $gt: currentTurn },
    })
    .project<Pick<SectorDemandCountryModifier, "sectorType" | "pct" | "expiresAtTurn">>({
      sectorType: 1,
      pct: 1,
      expiresAtTurn: 1,
    })
    .toArray();
  return sumActiveSectorDemandModifierPct(modifiers, sectorType, currentTurn);
}

/** Deletes modifiers that expired at or before `currentTurn`. Safe to run every turn. */
export async function sweepExpiredCountryModifiers(db: Db, currentTurn: number): Promise<number> {
  const result = await getCountryModifiersCollection(db).deleteMany({
    expiresAtTurn: { $lte: currentTurn },
  });
  return result.deletedCount ?? 0;
}
