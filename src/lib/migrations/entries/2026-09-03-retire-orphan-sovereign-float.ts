import type { Db } from "mongodb";
import type { Bond, FederalBudget } from "@/lib/db/types";
import { BOND_UNIT_FACE_VALUE } from "@/lib/db/types/bond";
import { getNationalBudgetId } from "@/lib/bonds/sovereign";
import type { CountryId } from "@/lib/constants/countries";
import type { Migration, MigrationContext, MigrationResult } from "../types";

/**
 * Retire sovereign paper that no debt stands behind.
 *
 * Quarterly rollover reissued every maturing series regardless of whether the
 * budget still owed anything, so surplus countries accumulated bond series
 * against a principal of zero (FR: 4.2T FRF, eight series). With a real bond
 * market pool those units would draw coupons from nothing. For every country
 * whose active sovereign face exceeds its budget principal, retire pool-held
 * units (`publicFloat`) newest series first until face is back at or below
 * principal. Holder positions are never touched: players paid for those. A
 * series left with no units at all is closed as matured.
 *
 * Idempotent: a second run finds no excess and does nothing.
 */
async function retireOrphanSovereignFloat(db: Db, ctx: MigrationContext): Promise<MigrationResult> {
  const turnDoc = await db
    .collection<{ _id: string; currentTurn?: number }>("gameState")
    .findOne({ _id: "current" }, { projection: { currentTurn: 1 } });
  const turn = turnDoc?.currentTurn ?? 0;

  const bonds = await db
    .collection<Bond>("bonds")
    .find({ issuerType: "sovereign", matured: false, defaulted: false })
    .toArray();
  const byCountry = new Map<CountryId, Bond[]>();
  for (const bond of bonds) {
    if (!bond.countryId) continue;
    const list = byCountry.get(bond.countryId) ?? [];
    list.push(bond);
    byCountry.set(bond.countryId, list);
  }

  const notes: string[] = [];
  const ops: Array<{
    updateOne: { filter: Record<string, unknown>; update: Record<string, unknown> };
  }> = [];
  let scanned = 0;
  const now = new Date();

  for (const [countryId, series] of byCountry) {
    scanned += series.length;
    const budget = await db
      .collection<FederalBudget>("federalBudget")
      .findOne({ _id: getNationalBudgetId(countryId) }, { projection: { debt: 1 } });
    if (!budget) continue;
    const principal = Math.max(0, budget.debt?.principal ?? 0);
    const face = series.reduce((sum, bond) => sum + (bond.totalIssued ?? 0), 0);
    let excess = face - principal;
    if (excess < BOND_UNIT_FACE_VALUE) continue;

    let retiredUnits = 0;
    let closed = 0;
    // Newest first: the most recent rollover is the one that should not have
    // happened; older paper is closer to maturing out on its own.
    for (const bond of [...series].sort((a, b) => b.issuedAtTurn - a.issuedAtTurn)) {
      if (excess < BOND_UNIT_FACE_VALUE) break;
      const floatUnits = Math.floor(bond.publicFloat ?? 0);
      if (floatUnits <= 0) continue;
      const retire = Math.min(floatUnits, Math.floor(excess / BOND_UNIT_FACE_VALUE));
      if (retire <= 0) continue;
      const heldUnits = (bond.holders ?? []).reduce((sum, h) => sum + (h.units ?? 0), 0);
      const remainingFloat = floatUnits - retire;
      const set: Record<string, unknown> = {
        publicFloat: remainingFloat,
        totalIssued: Math.max(0, (bond.totalIssued ?? 0) - retire * BOND_UNIT_FACE_VALUE),
        orphanFloatRetired: { turn, units: retire, principal },
        updatedAt: now,
      };
      if (heldUnits === 0 && remainingFloat === 0 && (bond.centralBankHoldings ?? 0) === 0) {
        set.matured = true;
        set.redeemedAtTurn = turn;
        set.marketPrice = 1;
        closed++;
      }
      ops.push({
        updateOne: {
          // Compare-and-set on the float we read so a trade landing between
          // read and write makes this op a no-op instead of a stale overwrite.
          filter: { _id: bond._id, publicFloat: bond.publicFloat },
          update: { $set: set },
        },
      });
      retiredUnits += retire;
      excess -= retire * BOND_UNIT_FACE_VALUE;
    }
    notes.push(
      `${countryId}: face ${Math.round(face).toLocaleString("en-US")} vs principal ${Math.round(principal).toLocaleString("en-US")}, retire ${retiredUnits.toLocaleString("en-US")} pool units, close ${closed} series`
    );
  }

  if (ctx.dryRun) {
    return {
      notes: [`would retire float on ${ops.length} sovereign series`, ...notes],
      documentsScanned: scanned,
      documentsUpdated: 0,
    };
  }
  let updated = 0;
  if (ops.length > 0) {
    const result = await db.collection<Bond>("bonds").bulkWrite(ops);
    updated = result.modifiedCount;
  }
  return {
    notes: [`retired float on ${updated} sovereign series`, ...notes],
    documentsScanned: scanned,
    documentsUpdated: updated,
  };
}

export const migration: Migration = {
  id: "2026-09-03-retire-orphan-sovereign-float",
  description:
    "Retire pool-held sovereign bond units that exceed the budget principal; holders untouched.",
  idempotent: true,
  execute: retireOrphanSovereignFloat,
};
