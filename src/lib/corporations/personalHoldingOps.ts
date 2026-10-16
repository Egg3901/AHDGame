/**
 * Personal stock holdings retain purchase age and cost through trading and escrow.
 * updatePersonalHolding compares the prior inventory before applying a lot change.
 */
import type { ClientSession, Db, ObjectId } from "mongodb";
import type { Corporation, Shareholder } from "@/lib/db/types";
import { getCorpFxRate } from "@/lib/currency/corporationCapital";
import { applyKeyedUpdate, type MoneyFlowLegOutcome } from "@/lib/db/nonAtomicMoneyFlow";
import {
  holdingCostBasis,
  holdingShares,
  mergeHoldingTerms,
  positionHoldingTerms,
  purchasedHoldingTerms,
  takeHoldingShares,
  takeReservedHoldingShares,
  subtractHoldingTerms,
  availableHoldingShares,
  type HoldingTerm,
  type ShareHoldingTerms,
} from "./rules/holdingTerms";

export interface PersonalHoldingChange {
  /** Turn shells supply their already-loaded activation flag. */
  trackingEnabled?: boolean;
  allowMixed?: boolean;
  turn: number;
  term?: HoldingTerm;
  /** Restorations retain original lots instead of creating a new purchase. */
  restore?: ShareHoldingTerms;
  remove?: ShareHoldingTerms;
  /** Populated only after the guarded write succeeds. */
  taken?: ShareHoldingTerms;
  outcome?: MoneyFlowLegOutcome;
  tracked?: boolean;
}
export async function updatePersonalHolding(input: {
  db: Db;
  corporationId: ObjectId;
  ownerId: ObjectId;
  ownerKey: "characterId" | "imperialCharacterId";
  shares: number;
  credit: boolean;
  pricePerShare?: number;
  change: PersonalHoldingChange;
  extra?: {
    $inc?: Record<string, number>;
    $set?: Record<string, unknown>;
    $unset?: Record<string, "" | 1 | true>;
  };
  guardFilter?: Record<string, unknown>;
  session?: ClientSession;
  key?: string;
}): Promise<number | null> {
  const { db, corporationId, ownerId, ownerKey, shares, credit, change, extra } = input;
  if (!Number.isSafeInteger(shares) || shares <= 0)
    throw new Error("Invalid personal share change");
  const corporations = db.collection<Corporation>("corporations");
  const options = input.session ? { session: input.session } : {};
  const state =
    change.trackingEnabled === undefined
      ? await db
          .collection<{ _id: string; stockHoldingTaxStartTurn?: number }>("gameState")
          .findOne({ _id: "current" }, { projection: { stockHoldingTaxStartTurn: 1 }, ...options })
      : null;
  const active =
    change.trackingEnabled ??
    (state?.stockHoldingTaxStartTurn !== undefined &&
      change.turn >= state.stockHoldingTaxStartTurn);
  change.tracked = active;
  let legacyFx: number | undefined;
  // bounded-cas-retry(maxAttempts=8): Retry only a lost compare-and-set on one holder; normal reads and writes run once, never once per player.
  for (let attempt = 0; attempt < 8; attempt++) {
    const corp = await corporations.findOne(
      { _id: corporationId },
      {
        projection: {
          shareholders: 1,
          countryId: 1,
          liquidCurrencyCode: 1,
          ...(input.key ? { appliedMoneyFlowKeys: { $elemMatch: { $eq: input.key } } } : {}),
        },
        ...options,
      }
    );
    if (!corp) return null;
    const holder = corp.shareholders?.find((row) => row[ownerKey]?.equals(ownerId));
    if (
      input.key &&
      (corp as Corporation & { appliedMoneyFlowKeys?: string[] }).appliedMoneyFlowKeys?.includes(
        input.key
      )
    ) {
      change.outcome = "already-applied";
      return holder?.shares ?? 0;
    }
    if (!credit && (!holder || holder.shares < shares)) return null;
    if (
      holder &&
      !holder.holdingTerms &&
      holder.avgCostBasisUnit !== "anchor" &&
      holder.avgCostPerShare !== undefined
    )
      legacyFx ??= await getCorpFxRate(db, corp);
    const normalizedHolder =
      holder &&
      !holder.holdingTerms &&
      holder.avgCostBasisUnit !== "anchor" &&
      holder.avgCostPerShare !== undefined
        ? { ...holder, avgCostPerShare: holder.avgCostPerShare / (legacyFx ?? 1) }
        : holder;
    // Recovery can replay an older purchase after a newer purchase landed.
    // Preserve its acquisition turn while evaluating existing inventory no
    // earlier than its newest lot.
    const evaluationTurn = Math.max(
      change.turn,
      ...(holder?.holdingTerms?.shortTermLots.map((lot) => lot.acquiredTurn) ?? [])
    );
    const previous = positionHoldingTerms(
      normalizedHolder ?? { shares: 0 },
      evaluationTurn,
      input.pricePerShare ?? 0
    );
    let next: ShareHoldingTerms;
    let taken: ShareHoldingTerms | undefined;
    if (credit) {
      const addition =
        change.restore ??
        (active
          ? purchasedHoldingTerms(shares, input.pricePerShare ?? 0, change.turn)
          : {
              longTermShares: shares,
              longTermCostBasisAnchor: shares * (input.pricePerShare ?? 0),
              shortTermLots: [],
            });
      if (holdingShares(addition) !== shares)
        throw new Error("Restored holding does not match share credit");
      next = mergeHoldingTerms(previous, addition, evaluationTurn);
    } else if (change.remove) {
      if (holdingShares(change.remove) !== shares)
        throw new Error("Compensated holding does not match debit");
      taken = active
        ? change.remove
        : {
            longTermShares: shares,
            longTermCostBasisAnchor: holdingCostBasis(change.remove),
            shortTermLots: [],
          };
      next = subtractHoldingTerms(previous, taken, evaluationTurn);
    } else {
      if (change.term && availableHoldingShares(previous, change.term) < shares) return null;
      if (
        !change.allowMixed &&
        !change.term &&
        previous.longTermShares > 0 &&
        previous.shortTermLots.length > 0
      )
        throw new Error("Choose Short Term Holdings or Long Term Holdings");
      const result = change.term
        ? takeHoldingShares(previous, shares, change.term, evaluationTurn)
        : takeReservedHoldingShares(previous, shares, evaluationTurn);
      next = result.remaining;
      taken = result.taken;
    }
    const count = holdingShares(next);
    const average = count ? holdingCostBasis(next) / count : 0;
    const row: Shareholder = {
      [ownerKey]: ownerId,
      shares: count,
      avgCostPerShare: average,
      avgCostBasisUnit: "anchor",
      ...(active || holder?.holdingTerms ? { holdingTerms: next } : {}),
    };
    const element = {
      [ownerKey]: ownerId,
      shares: holder?.shares,
      holdingTerms: holder?.holdingTerms ?? { $exists: false },
    };
    const filter = {
      _id: corporationId,
      ...input.guardFilter,
      shareholders: holder
        ? { $elemMatch: element }
        : { $not: { $elemMatch: { [ownerKey]: ownerId } } },
    };
    const update = holder
      ? {
          ...(extra?.$inc ? { $inc: extra.$inc } : {}),
          $set: {
            ...extra?.$set,
            "shareholders.$.shares": count,
            "shareholders.$.avgCostPerShare": average,
            "shareholders.$.avgCostBasisUnit": "anchor",
            ...(active || holder?.holdingTerms ? { "shareholders.$.holdingTerms": next } : {}),
          },
          ...(extra?.$unset ? { $unset: extra.$unset } : {}),
        }
      : {
          $push: { shareholders: row },
          ...(extra?.$inc ? { $inc: extra.$inc } : {}),
          ...(extra?.$set ? { $set: extra.$set } : {}),
          ...(extra?.$unset ? { $unset: extra.$unset } : {}),
        };
    if (input.key) {
      const outcome = await applyKeyedUpdate(
        input.key,
        { collection: corporations, filter, update },
        options
      );
      if (outcome !== "applied" && outcome !== "already-applied") continue;
      change.outcome = outcome;
    } else {
      const updated = await corporations.updateOne(filter, update, options);
      if (!updated.matchedCount) continue;
    }
    change.taken = taken;
    if (!count)
      await corporations.updateOne(
        { _id: corporationId },
        { $pull: { shareholders: { [ownerKey]: ownerId, shares: 0 } } },
        options
      );
    return count;
  }
  return null;
}
