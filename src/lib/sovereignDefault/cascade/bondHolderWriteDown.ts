/**
 * Per-bond, per-holder write-down recorder.
 *
 * A write-down is a PAPER loss, not a cash movement. Holders already paid
 * face value out of cash when they bought the bonds (`bond_purchase` debits
 * liquidCapital / personal balances at buy time), and portfolio valuations
 * (corporation + character) price holdings at `units × face × marketPrice` —
 * so the upstream marketPrice stamp (repudiate → 0.05, restructure haircut)
 * already encodes the loss in displayed wealth. Debiting holder cash here
 * would charge holders twice for the same principal (ticket #1266: a 95%
 * write-down drove holder corps hundreds of millions negative).
 *
 * This function therefore mutates nothing. It walks the bonds being written
 * down and returns the exposure report (who held what, total paper loss in
 * anchor) for cascade news and the orchestrator's holder scan.
 */

import { type ObjectId, type Db } from "mongodb";
import type { Bond } from "@/lib/db/types/bond";
import { BOND_UNIT_FACE_VALUE } from "@/lib/db/types/bond";
import { corpCapitalToAnchor, loadFxRatesByCurrency } from "@/lib/currency/corporationCapital";

export interface WriteDownReport {
  affectedCorpIds: ObjectId[];
  affectedCharacterIds: ObjectId[];
  affectedImperialCharacterIds: ObjectId[];
  affectedCountryStubs: string[];
  totalWrittenDownAnchor: number;
}

export async function applyBondHolderWriteDowns(
  db: Db,
  bondsBeingWrittenDown: Bond[],
  severity: number
): Promise<WriteDownReport> {
  const report: WriteDownReport = {
    affectedCorpIds: [],
    affectedCharacterIds: [],
    affectedImperialCharacterIds: [],
    affectedCountryStubs: [],
    totalWrittenDownAnchor: 0,
  };

  if (bondsBeingWrittenDown.length === 0 || severity <= 0) return report;

  const fxByCurrency = await loadFxRatesByCurrency(db);

  for (const bond of bondsBeingWrittenDown) {
    const bondCcy = bond.currencyCode;
    // Per BOND_UNIT_FACE_VALUE contract (db/types/bond.ts), the expression
    // `units × BOND_UNIT_FACE_VALUE × severity` is in the bond's LOCAL
    // currency, not anchor. Convert to anchor for the report total.
    // Pre-forex bonds (no currencyCode) are implicitly anchor-denominated;
    // corpCapitalToAnchor handles that case by returning the value unchanged.
    const bondFxRate = bondCcy ? (fxByCurrency.get(bondCcy) ?? 1) : 1;
    for (const h of bond.holders) {
      const writeDownLocal = h.units * BOND_UNIT_FACE_VALUE * severity;
      if (writeDownLocal <= 0) continue;
      const writeDownAnchor = corpCapitalToAnchor(writeDownLocal, bondCcy, bondFxRate);
      report.totalWrittenDownAnchor += writeDownAnchor;

      if (h.corporationId) {
        report.affectedCorpIds.push(h.corporationId);
      } else if (h.characterId) {
        if (!bondCcy) continue; // legacy bonds without currency stamp — defer to Phase 10 cleanup
        report.affectedCharacterIds.push(h.characterId);
      } else if (h.imperialCharacterId) {
        if (!bondCcy) continue;
        report.affectedImperialCharacterIds.push(h.imperialCharacterId);
      }
    }
  }

  return report;
}
