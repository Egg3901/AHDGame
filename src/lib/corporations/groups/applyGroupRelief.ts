/**
 * Apply group loss relief for the turn: credit the relieved tax back to the
 * corporations that paid it, and debit the country treasury that collected it.
 *
 * Conserved on both legs. Nothing is minted: every ₳ credited to a corporation
 * here was collected from that same group, in that same country, this same
 * turn — the cap in `computeGroupRelief` guarantees it.
 */

import { ObjectId, type Db } from "mongodb";
import type { Corporation } from "@/lib/db/types";
import type { CountryId } from "@/lib/constants/countries";
import type { CurrencyCode } from "@/lib/constants/currencies";
import {
  anchorToCorpLiquidCapital,
  getCorpFxRate,
  resolveCorpLiquidCurrencyCode,
} from "@/lib/currency/corporationCapital";
import { creditCorpLiquidCapital } from "@/lib/financialTxLog/atomicCashGuard";
import { emitTx } from "@/lib/financialTxLog/emit";
import { debitTreasury } from "@/lib/nationalization/treasury";
import { resolveFormalizedGroups } from "./groupMembership";
import {
  computeGroupRelief,
  poolByGroupAndCountry,
  type GroupMemberTaxPosition,
} from "./lossRelief";

/** The per-corp figures the turn already computed, narrowed to what relief needs. */
export interface CorpTaxSnapshotRow {
  corpId: ObjectId;
  incomePreDividends: number;
  federalTaxPaid: number;
  stateTaxPaid: number;
}

export interface GroupReliefResult {
  groupsRelieved: number;
  corpsCredited: number;
  totalReliefAnchor: number;
  errors: string[];
}

export async function applyGroupLossRelief(
  db: Db,
  snapshots: CorpTaxSnapshotRow[],
  currentTurn: number,
  now: Date
): Promise<GroupReliefResult> {
  const result: GroupReliefResult = {
    groupsRelieved: 0,
    corpsCredited: 0,
    totalReliefAnchor: 0,
    errors: [],
  };
  if (snapshots.length === 0) return result;

  const membership = await resolveFormalizedGroups(db);
  if (membership.membersByRootId.size === 0) return result;

  // Only corps that are actually in a multi-member group can matter.
  const groupedIds = new Set<string>();
  for (const members of membership.membersByRootId.values()) {
    for (const id of members) groupedIds.add(id);
  }
  const relevant = snapshots.filter((s) => groupedIds.has(s.corpId.toString()));
  if (relevant.length === 0) return result;

  const corps = await db
    .collection<Corporation>("corporations")
    .find({ _id: { $in: relevant.map((s) => s.corpId) } })
    .toArray();
  const corpById = new Map(corps.map((c) => [c._id.toString(), c]));

  const positions: Array<GroupMemberTaxPosition & { groupRootId: string }> = [];
  for (const snap of relevant) {
    const corp = corpById.get(snap.corpId.toString());
    if (!corp?.countryId) continue;
    // State-owned corps are outside the private tax group entirely.
    if (corp.countryOwnerId || corp.ownershipState === "stateOwned") continue;
    positions.push({
      corporationId: snap.corpId,
      countryId: corp.countryId,
      groupRootId: membership.rootByCorpId.get(snap.corpId.toString()) ?? snap.corpId.toString(),
      incomePreTaxAnchor: snap.incomePreDividends,
      taxPaidAnchor: (snap.federalTaxPaid ?? 0) + (snap.stateTaxPaid ?? 0),
    });
  }

  for (const [, pool] of poolByGroupAndCountry(positions)) {
    const outcome = computeGroupRelief(pool);
    if (outcome.allocations.length === 0) continue;

    let creditedThisGroup = 0;
    for (const allocation of outcome.allocations) {
      const corp = corpById.get(allocation.corporationId.toString());
      if (!corp) continue;
      try {
        const fxRate = await getCorpFxRate(db, corp);
        const localAmount = Math.round(
          anchorToCorpLiquidCapital(allocation.reliefAnchor, corp, fxRate)
        );
        if (localAmount <= 0) continue;

        await creditCorpLiquidCapital(db, corp._id, localAmount);
        await debitTreasury(db, allocation.countryId as CountryId, localAmount, now);
        await emitTx(db, {
          type: "corp_group_relief",
          turn: currentTurn,
          createdAt: now,
          subjectType: "corporation",
          subjectId: corp._id,
          subjectName: corp.name,
          amount: localAmount,
          currencyCode: (resolveCorpLiquidCurrencyCode(corp) ?? "USD") as CurrencyCode,
          counterpartyType: "government",
          counterpartyName: `${allocation.countryId} treasury`,
          meta: {
            kind: "group_loss_relief",
            countryId: allocation.countryId,
            reliefAnchor: allocation.reliefAnchor,
            lossesSurrenderedAnchor: outcome.lossesSurrenderedAnchor,
          },
        });
        result.corpsCredited += 1;
        result.totalReliefAnchor += allocation.reliefAnchor;
        creditedThisGroup += 1;
      } catch (err) {
        result.errors.push(
          `group relief ${corp.name}: ${err instanceof Error ? err.message : String(err)}`
        );
      }
    }
    if (creditedThisGroup > 0) result.groupsRelieved += 1;
  }

  return result;
}
