/**
 * Apply restructure terms to all active sovereign bonds for a country.
 *
 * Per-bond logic: stamp haircut + extended maturity + restructured market
 * price. Preserve the pre-restructure `originalMaturityTurn` and
 * `originalTotalIssued` only on the first restructure (idempotent on
 * compounding restructures).
 *
 * Cascade write-downs to bondholders are Phase 7. Phase 6 only stamps the
 * issuer-side restructure terms.
 */

import type { Db, AnyBulkWriteOperation } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";
import type { Bond } from "@/lib/db/types/bond";
import { RESTRUCTURE_BOND_MARKET_PRICE } from "../constants";

export async function applyCountryBondRestructure(
  db: Db,
  countryCode: CountryId,
  haircutPercent: number,
  maturityExtensionTurns: number
): Promise<{ bondsAffected: number }> {
  const bonds = await db
    .collection<Bond>("bonds")
    .find({
      issuerType: "sovereign",
      countryId: countryCode,
      matured: false,
      defaulted: false,
    })
    .toArray();

  if (bonds.length === 0) return { bondsAffected: 0 };

  const now = new Date();
  const ops: AnyBulkWriteOperation<Bond>[] = bonds.map((bond) => {
    const set: Record<string, unknown> = {
      restructureHaircutPercent: haircutPercent,
      restructureExtendedMaturityTurn: bond.maturityTurn + maturityExtensionTurns,
      marketPrice: RESTRUCTURE_BOND_MARKET_PRICE,
      updatedAt: now,
    };
    if (bond.originalMaturityTurn === null || bond.originalMaturityTurn === undefined) {
      set.originalMaturityTurn = bond.maturityTurn;
    }
    if (bond.originalTotalIssued === null || bond.originalTotalIssued === undefined) {
      set.originalTotalIssued = bond.totalIssued;
    }
    return {
      updateOne: {
        filter: { _id: bond._id },
        update: { $set: set },
      },
    };
  });

  await db.collection<Bond>("bonds").bulkWrite(ops);
  return { bondsAffected: ops.length };
}
