/**
 * Per-bond, per-holder write-down dispatcher.
 *
 * For each bond in the cascade level, debit each holder by
 * (units * BOND_UNIT_FACE_VALUE * severity), with currency conversion for
 * corp holders' liquidCapital and a direct local-currency debit for
 * character / imperialCharacter personal balances.
 *
 * country-stub holders (foreign reserves system not yet built) are logged
 * and counted but not mutated — the kind: "country" dispatch arm will go live
 * when reserves land.
 */

import { ObjectId, type AnyBulkWriteOperation, type Db } from "mongodb";
import type { Bond } from "@/lib/db/types/bond";
import type { Character, Corporation } from "@/lib/db/types";
import type { ImperialCharacter } from "@/lib/db/types/imperialCharacter";
import { BOND_UNIT_FACE_VALUE } from "@/lib/db/types/bond";
import {
  anchorToCorpLiquidCapital,
  corpCapitalToAnchor,
  fxRateForCorpFromMap,
  loadFxRatesByCurrency,
} from "@/lib/currency/corporationCapital";
import { buildPersonalBalanceBulkOp } from "@/lib/currency/characterFunds";

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
  severity: number,
  forexEnabled: boolean
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

  // Collect holder corp ids to load in one pass for currency conversion.
  const corpHolderIdSet = new Set<string>();
  for (const bond of bondsBeingWrittenDown) {
    for (const h of bond.holders) {
      if (h.corporationId) corpHolderIdSet.add(h.corporationId.toString());
    }
  }
  const corpHolders = corpHolderIdSet.size
    ? await db
        .collection<Corporation>("corporations")
        .find({ _id: { $in: [...corpHolderIdSet].map((id) => new ObjectId(id)) } })
        .toArray()
    : [];
  const corpById = new Map(corpHolders.map((c) => [c._id.toString(), c]));

  const corpOps: AnyBulkWriteOperation<Corporation>[] = [];
  const charOps: AnyBulkWriteOperation<Character>[] = [];
  const imperialOps: AnyBulkWriteOperation<ImperialCharacter>[] = [];

  for (const bond of bondsBeingWrittenDown) {
    const bondCcy = bond.currencyCode;
    // Per BOND_UNIT_FACE_VALUE contract (db/types/bond.ts:160-178), the
    // expression `units × BOND_UNIT_FACE_VALUE × severity` is in the bond's
    // LOCAL currency, not anchor. We must convert to anchor before debiting
    // a corp's liquidCapital (which has its own currency via
    // anchorToCorpLiquidCapital). Pre-forex bonds (no currencyCode) are
    // implicitly anchor-denominated; corpCapitalToAnchor handles that case
    // by returning the value unchanged.
    const bondFxRate = bondCcy ? (fxByCurrency.get(bondCcy) ?? 1) : 1;
    for (const h of bond.holders) {
      const writeDownLocal = h.units * BOND_UNIT_FACE_VALUE * severity;
      if (writeDownLocal <= 0) continue;
      const writeDownAnchor = corpCapitalToAnchor(writeDownLocal, bondCcy, bondFxRate);
      report.totalWrittenDownAnchor += writeDownAnchor;

      if (h.corporationId) {
        const corp = corpById.get(h.corporationId.toString());
        if (!corp) continue;
        const corpFx = fxRateForCorpFromMap(corp, fxByCurrency);
        const debitInCorpCurrency = anchorToCorpLiquidCapital(writeDownAnchor, corp, corpFx);
        corpOps.push({
          updateOne: {
            filter: { _id: corp._id as ObjectId },
            update: { $inc: { liquidCapital: -debitInCorpCurrency } },
          },
        });
        report.affectedCorpIds.push(corp._id);
      } else if (h.characterId) {
        if (!bondCcy) continue; // legacy bonds without currency stamp — defer to Phase 10 cleanup
        charOps.push(
          buildPersonalBalanceBulkOp(
            h.characterId,
            -writeDownLocal,
            bondCcy,
            forexEnabled
          ) as AnyBulkWriteOperation<Character>
        );
        report.affectedCharacterIds.push(h.characterId);
      } else if (h.imperialCharacterId) {
        if (!bondCcy) continue;
        imperialOps.push(
          buildPersonalBalanceBulkOp(
            h.imperialCharacterId,
            -writeDownLocal,
            bondCcy,
            forexEnabled
          ) as AnyBulkWriteOperation<ImperialCharacter>
        );
        report.affectedImperialCharacterIds.push(h.imperialCharacterId);
      }
    }
  }

  if (corpOps.length > 0) {
    await db.collection<Corporation>("corporations").bulkWrite(corpOps);
  }
  if (charOps.length > 0) {
    await db.collection<Character>("characters").bulkWrite(charOps);
  }
  if (imperialOps.length > 0) {
    await db.collection<ImperialCharacter>("imperialCharacters").bulkWrite(imperialOps);
  }

  return report;
}
