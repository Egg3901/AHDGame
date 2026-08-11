import { ObjectId, type AnyBulkWriteOperation, type Db } from "mongodb";
import type { Bond, Corporation } from "@/lib/db/types";
import type { CurrencyCode } from "@/lib/constants/currencies";
import { COUNTRY_CURRENCY_MAP } from "@/lib/constants/currencies";
import { computeBondShortfallEscrowCover } from "@/lib/corporations/escrowFunding";
import {
  anchorToCorpCapital,
  fxRateForCorpFromMap,
  resolveCorpLiquidCurrencyCode,
} from "@/lib/currency/corporationCapital";

/**
 * Bonds-only exception to escrow ring-fencing: before declaring a corp defaulted
 * on its bond obligations, let it cover a negative liquidCapital from a POSITIVE
 * share-buyback escrow (move escrow → liquidCapital, capped at the escrow balance,
 * never below 0). Mutates the passed corps' `liquidCapital` in place so the caller
 * can re-test solvency, persists the moves via bulkWrite, and returns the set of
 * corp ids still negative after cover (the true defaults). Escrow and liquidCapital
 * are both corp-local, so the move is 1:1.
 */
export async function coverBondShortfallsFromEscrow(
  db: Db,
  corps: { _id: ObjectId; liquidCapital: number; shareEscrowBalance?: number }[],
  now: Date
): Promise<Set<string>> {
  const ops: AnyBulkWriteOperation<Corporation>[] = [];
  const stillNegative = new Set<string>();
  for (const corp of corps) {
    const cover = computeBondShortfallEscrowCover({
      liquidCapital: corp.liquidCapital,
      escrowBalance: corp.shareEscrowBalance ?? 0,
    });
    if (cover > 0) {
      corp.liquidCapital += cover;
      ops.push({
        updateOne: {
          filter: { _id: corp._id },
          update: {
            $inc: { liquidCapital: cover, shareEscrowBalance: -cover },
            $set: { updatedAt: now },
          },
        },
      });
    }
    if (corp.liquidCapital < 0) stillNegative.add(corp._id.toString());
  }
  if (ops.length > 0) await db.collection<Corporation>("corporations").bulkWrite(ops);
  return stillNegative;
}

/**
 * Resolve a bond's denomination currency from `bond.currencyCode` first,
 * falling back to the bond's country-inferred currency for pre-migration
 * rows. **Never** derives from the issuer corp's current country — Task-18B
 * canonicalizes `bond.currencyCode` as the denomination of record, and
 * admin-initiated cross-country HQ moves would otherwise silently
 * re-denominate outstanding bonds (see docs/design/corporations.md §HQ
 * Relocation → Bond denomination).
 */
export function resolveBondCurrency(bond: Bond): CurrencyCode {
  if (bond.currencyCode) return bond.currencyCode as CurrencyCode;
  if (bond.countryId && bond.countryId in COUNTRY_CURRENCY_MAP) {
    return COUNTRY_CURRENCY_MAP[bond.countryId as keyof typeof COUNTRY_CURRENCY_MAP];
  }
  return "USD";
}

/**
 * Maturity face-value flows pre-computed in Phase 1.5 so they enter the
 * unified pre-default delta (Phase 2) instead of the post-default Phase 5.
 * Tracked per-bond as well so a newly-defaulted issuer's maturity flows can
 * be rolled back (Phase 3.5) — the bond becomes defaulted, not matured, and
 * holders never actually receive face value.
 */
export type BondMaturityFlow = {
  bond: Bond;
  issuerCostAnchor: number;
  holderCorpCreditsAnchor: Map<string, number>;
};

/**
 * Phase 3.5: Roll back maturity flows for newly-defaulted issuers.
 *
 * Phase 1.5 optimistically applied maturity face value to issuers (debit)
 * and corp holders (credit) so the default check could see net flow. When
 * an issuer ends up defaulting, the bond is marked defaulted (not matured)
 * by Phase 4 and per existing semantics holders never receive face value
 * and the issuer never pays it. Reverse those optimistic writes here.
 *
 * Cascade: if a holder corp's solvency depended on the rolled-back income
 * (their post-clawback balance is now negative), they default too — and
 * their own maturity flows must be rolled back, potentially cascading
 * further. The loop processes one wave of defaults per iteration and
 * terminates when no new corps fall under zero. Convergence is guaranteed
 * because each iteration adds at least one corp to `processedFlows`, which
 * is bounded by the number of distinct issuers with maturity flows.
 *
 * Mutates `defaultedCorps` in place, adding cascade-defaulted holder corps.
 */
export async function rollbackDefaultedIssuerMaturityFlows(args: {
  db: Db;
  bondMaturityFlows: BondMaturityFlow[];
  defaultedCorps: Set<string>;
  corpMap: Map<string, Corporation>;
  natcorpIds: Set<string>;
  fxByCurrency: Map<CurrencyCode, number>;
  now: Date;
}): Promise<void> {
  const { db, bondMaturityFlows, defaultedCorps, corpMap, natcorpIds, fxByCurrency, now } = args;
  if (bondMaturityFlows.length > 0) {
    const processedFlowIssuers = new Set<string>();
    let pending = new Set(defaultedCorps);
    while (pending.size > 0) {
      const rollbackOps = [];
      const affectedHolders = new Set<string>();
      for (const flow of bondMaturityFlows) {
        const issuerCorpIdStr = flow.bond.corporationId.toString();
        if (!pending.has(issuerCorpIdStr)) continue;
        if (processedFlowIssuers.has(issuerCorpIdStr)) continue;

        if (flow.issuerCostAnchor > 0) {
          const issuer = corpMap.get(issuerCorpIdStr);
          const refundLocal = anchorToCorpCapital(
            flow.issuerCostAnchor,
            resolveCorpLiquidCurrencyCode(issuer),
            fxRateForCorpFromMap(issuer, fxByCurrency)
          );
          rollbackOps.push({
            updateOne: {
              filter: { _id: new ObjectId(issuerCorpIdStr) },
              update: { $inc: { liquidCapital: refundLocal }, $set: { updatedAt: now } },
            },
          });
        }

        for (const [holderCorpIdStr, creditAnchor] of flow.holderCorpCreditsAnchor) {
          const holder = corpMap.get(holderCorpIdStr);
          const clawbackLocal = anchorToCorpCapital(
            creditAnchor,
            resolveCorpLiquidCurrencyCode(holder),
            fxRateForCorpFromMap(holder, fxByCurrency)
          );
          rollbackOps.push({
            updateOne: {
              filter: { _id: new ObjectId(holderCorpIdStr) },
              update: { $inc: { liquidCapital: -clawbackLocal }, $set: { updatedAt: now } },
            },
          });
          affectedHolders.add(holderCorpIdStr);
        }
      }
      for (const id of pending) processedFlowIssuers.add(id);
      pending = new Set();

      if (rollbackOps.length > 0) {
        await db.collection("corporations").bulkWrite(rollbackOps);
      }

      if (affectedHolders.size > 0) {
        const updated = await db
          .collection<Corporation>("corporations")
          .find({ _id: { $in: [...affectedHolders].map((id) => new ObjectId(id)) } })
          .project<{ _id: ObjectId; liquidCapital: number; shareEscrowBalance?: number }>({
            _id: 1,
            liquidCapital: 1,
            shareEscrowBalance: 1,
          })
          .toArray();
        // Same bonds-only escrow fallback for cascade-affected holders: cover a
        // negative balance from positive escrow before cascading the default.
        const cascadeCandidates = updated.filter(
          (corp) =>
            corp.liquidCapital < 0 &&
            !defaultedCorps.has(corp._id.toString()) &&
            !natcorpIds.has(corp._id.toString())
        );
        const stillNegative = await coverBondShortfallsFromEscrow(db, cascadeCandidates, now);
        for (const idStr of stillNegative) {
          defaultedCorps.add(idStr);
          pending.add(idStr);
        }
      }
    }
  }
}
