import { ObjectId, type Db } from "mongodb";
import type { Bond } from "@/lib/db/types/bond";
import type { FederalBudget, FundedSovereignCouponClaim } from "@/lib/db/types/budget";
import type { Corporation } from "@/lib/db/types/corporation";
import { resolveCorpLiquidCurrencyCode } from "@/lib/currency/corporationCapital";
import { bondAccruesCoupon } from "@/lib/constants/bonds";
import { settleTransition, resumeSettlement } from "@/lib/banking/settlementJournal";
import type { BankingTransition } from "@/lib/banking/rules/boundary";
import {
  freezeSovereignCouponClaim,
  type SovereignCouponCorporationQuote,
} from "@/lib/banking/rules/sovereignCoupons";

function payoutTransition(
  claim: FundedSovereignCouponClaim,
  budgetId: string,
  attemptTurn: number
): BankingTransition {
  const key = `${claim.id}:attempt:${attemptTurn}`;
  const legs: BankingTransition["legs"] = [
    {
      kind: "debit",
      amount: claim.amountLocal,
      valuation: { currencyCode: claim.currencyCode, localPerAnchor: claim.anchorRate },
      collection: "federalBudget",
      filter: { _id: budgetId, treasuryCashLocal: { $gte: claim.amountLocal } },
      path: "treasuryCashLocal",
      note: "Pay sovereign coupon claims from funded Treasury cash",
    },
  ];
  for (const holder of claim.holders) {
    if (holder.kind === "publicFloat") {
      legs.push({
        kind: "credit",
        amount: holder.amountLocal,
        valuation: { currencyCode: claim.currencyCode, localPerAnchor: claim.anchorRate },
        collection: "bondMarketPools",
        filter: { _id: claim.currencyCode },
        path: "cashLocal",
        note: "Pay public-float sovereign coupon to its bond pool",
      });
    } else if (holder.kind === "character" || holder.kind === "imperial") {
      const path = holder.personalBalancePath;
      if (!path || !holder.id)
        throw new Error(`Invalid frozen sovereign coupon holder ${claim.id}`);
      legs.push({
        kind: "credit",
        amount: holder.amountLocal,
        valuation: { currencyCode: claim.currencyCode, localPerAnchor: claim.anchorRate },
        collection: holder.kind === "character" ? "characters" : "imperialCharacters",
        filter: { _id: new ObjectId(holder.id) },
        path,
        note: "Pay frozen sovereign coupon to personal cash",
      });
    } else if (holder.kind === "corporation") {
      if (!holder.id) throw new Error(`Missing corporation in sovereign coupon ${claim.id}`);
      const payeeRate = holder.payeeLocalPerAnchor;
      const payeeCurrency = holder.payeeCurrencyCode;
      if (!payeeRate || !payeeCurrency)
        throw new Error(`Missing frozen corporate FX quote for ${claim.id}`);
      legs.push({
        kind: "credit",
        amount: holder.amountAnchor * payeeRate,
        valuation: { currencyCode: payeeCurrency, localPerAnchor: payeeRate },
        collection: "corporations",
        filter: {
          _id: new ObjectId(holder.id),
          ...(holder.payeeHasExplicitCurrency
            ? { liquidCurrencyCode: payeeCurrency }
            : { liquidCurrencyCode: { $exists: false }, countryId: holder.payeeCountryId }),
        },
        path: "liquidCapital",
        note: "Pay frozen sovereign coupon to corporate cash",
      });
    } else if (holder.kind === "fund") {
      if (!holder.id) throw new Error(`Missing index fund in sovereign coupon ${claim.id}`);
      legs.push({
        kind: "credit",
        amount: holder.amountAnchor,
        valuation: { currencyCode: "ANCHOR", localPerAnchor: 1 },
        collection: "indexFunds",
        filter: { _id: new ObjectId(holder.id) },
        path: "cashAnchor",
        note: "Pay frozen sovereign coupon to index-fund cash",
      });
    } else if (holder.kind === "npp") {
      if (!holder.id) throw new Error(`Missing NPP in sovereign coupon ${claim.id}`);
      legs.push({
        kind: "credit",
        amount: holder.amountAnchor,
        valuation: { currencyCode: "ANCHOR", localPerAnchor: 1 },
        collection: "npps",
        filter: { _id: new ObjectId(holder.id) },
        path: "nppInvestmentCashAnchor",
        note: "Pay frozen sovereign coupon to NPP investment cash",
      });
    }
  }
  return {
    key,
    kind: "sovereign_coupon_funded_payout",
    turn: attemptTurn,
    currency: claim.currencyCode,
    legs,
    projections: [
      {
        collection: "federalBudget",
        filter: { _id: budgetId, "sovereignCouponClaims.id": claim.id },
        update: { $pull: { sovereignCouponClaims: { id: claim.id } } },
        note: "Remove paid sovereign coupon claim",
      },
      ...claim.holders
        .filter((holder) => holder.kind === "publicFloat")
        .map((holder) => ({
          collection: "bondMarketPools",
          filter: { _id: claim.currencyCode },
          update: { $inc: { "lifetime.couponsIn": holder.amountLocal } },
          note: "Record funded public-float coupon receipt",
        })),
    ],
    event: {
      kind: "monetary.executed",
      command: "turn.sovereignCoupon.fundedPayout",
      subjectType: "country",
      subjectId: claim.countryId,
      amount: claim.amountLocal,
      meta: { claimId: claim.id, bondId: claim.bondId },
    },
  };
}

/** Freeze due-turn holder quotes before attempts; funded payout is journaled as one balanced native-currency move. */
export async function settleFundedSovereignCoupons(
  db: Db,
  budget: Pick<
    FederalBudget,
    "_id" | "countryId" | "sovereignCouponClaims" | "sovereignCouponFrozenThrough"
  >,
  input: {
    turn: number;
    bonds: Bond[];
    anchorRate: number;
    forexEnabled: boolean;
    corporateQuotes: ReadonlyMap<string, SovereignCouponCorporationQuote>;
  }
): Promise<void> {
  const collection = db.collection<FederalBudget>("federalBudget");
  const claimById = new Map((budget.sovereignCouponClaims ?? []).map((claim) => [claim.id, claim]));
  for (const bond of input.bonds) {
    if (
      bond.issuerType !== "sovereign" ||
      bond.defaulted ||
      bond.matured ||
      !bondAccruesCoupon(bond)
    )
      continue;
    const claim = freezeSovereignCouponClaim({
      bond,
      turn: input.turn,
      anchorRate: input.anchorRate,
      forexEnabled: input.forexEnabled,
      corporateQuotes: input.corporateQuotes,
    });
    if (!claim) continue;
    const frozenKey = `b${claim.bondId}`;
    const frozenPath = `sovereignCouponFrozenThrough.${frozenKey}`;
    const alreadyFrozen =
      budget.sovereignCouponFrozenThrough?.[frozenKey] !== undefined &&
      budget.sovereignCouponFrozenThrough[frozenKey] >= claim.dueTurn;
    if (alreadyFrozen && !claimById.has(claim.id)) continue;
    const result = await collection.updateOne(
      {
        _id: budget._id,
        "sovereignCouponClaims.id": { $ne: claim.id },
        $or: [{ [frozenPath]: { $exists: false } }, { [frozenPath]: { $lt: claim.dueTurn } }],
      },
      {
        $push: { sovereignCouponClaims: claim },
        $set: { [frozenPath]: claim.dueTurn },
      }
    );
    if (result.matchedCount === 0) {
      const current = await collection.findOne(
        { _id: budget._id },
        { projection: { sovereignCouponClaims: 1, sovereignCouponFrozenThrough: 1 } }
      );
      const frozen = current?.sovereignCouponClaims?.find((row) => row.id === claim.id);
      if (frozen && JSON.stringify(frozen) !== JSON.stringify(claim))
        throw new Error(`Sovereign coupon quote changed for ${claim.id}`);
      if (frozen) claimById.set(claim.id, frozen);
      else if ((current?.sovereignCouponFrozenThrough?.[frozenKey] ?? -1) < claim.dueTurn)
        throw new Error(`Sovereign coupon claim install lost for ${claim.id}`);
    } else claimById.set(claim.id, claim);
  }
  for (const claim of claimById.values()) {
    const attempt = Math.max(input.turn, claim.dueTurn);
    const attemptPrefix = `^${claim.id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}:attempt:`;
    const prior =
      (await db
        .collection<{ _id: string; status: string }>("bankMoneyMoves")
        .findOne(
          { _id: { $regex: attemptPrefix }, status: "partial" },
          { projection: { _id: 1 } }
        )) ??
      (await db
        .collection<{ _id: string; status: string }>("bankMoneyMoves")
        .findOne(
          { _id: { $regex: attemptPrefix }, status: "applied" },
          { projection: { _id: 1 } }
        ));
    if (!prior && !(await couponTargetsExist(db, claim))) continue;
    const result = prior
      ? await resumeSettlement(db, prior._id)
      : await settleTransition(db, payoutTransition(claim, String(budget._id), attempt));
    if (result.status === "partial") return;
    // A wholly rejected source guard has no landed cash leg. Keep the immutable claim for the next turn.
  }
}

async function couponTargetsExist(db: Db, claim: FundedSovereignCouponClaim): Promise<boolean> {
  const pools = claim.holders.filter((holder) => holder.kind === "publicFloat");
  if (pools.length > 0) {
    await db
      .collection<{ _id: string }>("bondMarketPools")
      .updateOne(
        { _id: claim.currencyCode },
        { $setOnInsert: { targetCashLocal: 0, createdAt: new Date() } },
        { upsert: true }
      );
  }
  const collections = new Map<string, Set<string>>();
  const corporationHolders = claim.holders.filter((holder) => holder.kind === "corporation");
  for (const holder of claim.holders) {
    if (!holder.id) continue;
    const collection =
      holder.kind === "character"
        ? "characters"
        : holder.kind === "imperial"
          ? "imperialCharacters"
          : holder.kind === "corporation"
            ? "corporations"
            : holder.kind === "fund"
              ? "indexFunds"
              : holder.kind === "npp"
                ? "npps"
                : null;
    if (!collection) continue;
    const ids = collections.get(collection) ?? new Set<string>();
    ids.add(holder.id);
    collections.set(collection, ids);
  }
  for (const [collection, ids] of collections) {
    const found =
      collection === "corporations"
        ? await db
            .collection<Corporation>(collection)
            .find(
              { _id: { $in: [...ids].map((id) => new ObjectId(id)) } },
              { projection: { _id: 1, countryId: 1, liquidCurrencyCode: 1 } }
            )
            .toArray()
        : await db
            .collection<{ _id: ObjectId }>(collection)
            .find(
              { _id: { $in: [...ids].map((id) => new ObjectId(id)) } },
              { projection: { _id: 1 } }
            )
            .toArray();
    if (new Set(found.map((row) => row._id.toHexString())).size !== ids.size) return false;
    if (collection === "corporations") {
      const byId = new Map((found as Corporation[]).map((corp) => [corp._id.toHexString(), corp]));
      for (const holder of corporationHolders) {
        const corp = holder.id ? byId.get(holder.id) : undefined;
        if (!corp || resolveCorpLiquidCurrencyCode(corp) !== holder.payeeCurrencyCode) return false;
      }
    }
  }
  return true;
}
