import { ObjectId, type Db } from "mongodb";
import type { Bond, BondHolder } from "@/lib/db/types/bond";
import type { FederalBudget, FundedSovereignCouponClaim } from "@/lib/db/types/budget";
import type { CurrencyCode } from "@/lib/constants/currencies";
import { bondAccruesCoupon, perTurnCouponPayment } from "@/lib/constants/bonds";
import { BOND_UNIT_FACE_VALUE } from "@/lib/db/types/bond";
import { buildPersonalBalanceInc } from "@/lib/currency/characterFunds";
import { settleTransition, resumeSettlement } from "@/lib/banking/settlementJournal";
import type { BankingTransition } from "@/lib/banking/rules/boundary";
import type { Corporation } from "@/lib/db/types/corporation";
import {
  fxRateForCorpFromMap,
  resolveCorpLiquidCurrencyCode,
} from "@/lib/currency/corporationCapital";

function holderClaim(
  bond: Bond,
  turn: number,
  anchorRate: number,
  corpQuotes: ReadonlyMap<string, { currencyCode: CurrencyCode; localPerAnchor: number }>
): FundedSovereignCouponClaim | null {
  const currencyCode = (bond.currencyCode ?? "USD") as CurrencyCode;
  const perUnit = perTurnCouponPayment(bond.couponRate, BOND_UNIT_FACE_VALUE);
  const amount = (units: number) => perUnit * Math.max(0, units);
  const holders: FundedSovereignCouponClaim["holders"] = [];
  if (bond.publicFloat > 0) {
    const amountLocal = amount(bond.publicFloat);
    holders.push({
      kind: "publicFloat",
      amountLocal,
      amountAnchor: amountLocal / anchorRate,
      currencyCode,
    });
  }
  for (const holder of bond.holders ?? []) {
    if (holder.bankId || holder.bankTreasuryTradeId || holder.units <= 0) continue;
    const amountLocal = amount(holder.units);
    const base = { amountLocal, amountAnchor: amountLocal / anchorRate };
    const corpQuote = holder.corporationId
      ? corpQuotes.get(holder.corporationId.toHexString())
      : undefined;
    if (holder.corporationId && !corpQuote)
      throw new Error(`Missing corporate FX quote for sovereign coupon ${bond._id}`);
    const row = identifyHolder(holder, currencyCode, base, corpQuote);
    if (row) holders.push(row);
  }
  const amountLocal = holders.reduce((sum, row) => sum + row.amountLocal, 0);
  if (!(amountLocal > 0)) return null;
  return {
    id: `sovereign-coupon:${bond._id.toHexString()}:${turn}`,
    bondId: bond._id.toHexString(),
    dueTurn: turn,
    countryId: String(bond.countryId ?? ""),
    currencyCode,
    amountLocal,
    anchorRate,
    holders,
  };
}

function identifyHolder(
  holder: BondHolder,
  currencyCode: CurrencyCode,
  amount: { amountLocal: number; amountAnchor: number },
  corpQuote?: { currencyCode: CurrencyCode; localPerAnchor: number }
): FundedSovereignCouponClaim["holders"][number] | null {
  if (holder.characterId)
    return { ...amount, kind: "character", id: holder.characterId.toHexString(), currencyCode };
  if (holder.imperialCharacterId)
    return {
      ...amount,
      kind: "imperial",
      id: holder.imperialCharacterId.toHexString(),
      currencyCode,
    };
  if (holder.corporationId && corpQuote)
    return {
      ...amount,
      kind: "corporation",
      id: holder.corporationId.toHexString(),
      currencyCode,
      payeeCurrencyCode: corpQuote.currencyCode,
      payeeLocalPerAnchor: corpQuote.localPerAnchor,
    };
  if (holder.fundId) return { ...amount, kind: "fund", id: holder.fundId.toHexString() };
  if (holder.nppId) return { ...amount, kind: "npp", id: holder.nppId.toHexString() };
  return null;
}

function payoutTransition(
  claim: FundedSovereignCouponClaim,
  budgetId: string,
  attemptTurn: number,
  forexEnabled: boolean
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
      const personal = buildPersonalBalanceInc(
        1,
        holder.currencyCode ?? claim.currencyCode,
        forexEnabled
      );
      const path = Object.keys(personal)[0];
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
        filter: { _id: new ObjectId(holder.id) },
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
  budget: Pick<FederalBudget, "_id" | "countryId" | "sovereignCouponClaims">,
  input: {
    turn: number;
    bonds: Bond[];
    anchorRate: number;
    forexEnabled: boolean;
    fxByCurrency: ReadonlyMap<CurrencyCode, number>;
  }
): Promise<void> {
  const collection = db.collection<FederalBudget>("federalBudget");
  const claimById = new Map((budget.sovereignCouponClaims ?? []).map((claim) => [claim.id, claim]));
  const corporationIds = [
    ...new Set(
      input.bonds.flatMap((bond) =>
        (bond.holders ?? []).flatMap((holder) =>
          holder.corporationId ? [holder.corporationId] : []
        )
      )
    ),
  ];
  const corporations = corporationIds.length
    ? await db
        .collection<Corporation>("corporations")
        .find(
          { _id: { $in: corporationIds } },
          { projection: { _id: 1, countryId: 1, liquidCurrencyCode: 1 } }
        )
        .toArray()
    : [];
  const corpQuotes = new Map<string, { currencyCode: CurrencyCode; localPerAnchor: number }>();
  for (const corp of corporations) {
    const currencyCode = resolveCorpLiquidCurrencyCode(corp);
    if (!currencyCode) continue;
    if (!input.fxByCurrency.has(currencyCode)) continue;
    const localPerAnchor = fxRateForCorpFromMap(corp, input.fxByCurrency);
    if (Number.isFinite(localPerAnchor) && localPerAnchor > 0)
      corpQuotes.set(corp._id.toHexString(), { currencyCode, localPerAnchor });
  }
  for (const bond of input.bonds) {
    if (
      bond.issuerType !== "sovereign" ||
      bond.defaulted ||
      bond.matured ||
      !bondAccruesCoupon(bond)
    )
      continue;
    const claim = holderClaim(bond, input.turn, input.anchorRate, corpQuotes);
    if (!claim) continue;
    const result = await collection.updateOne(
      { _id: budget._id, "sovereignCouponClaims.id": { $ne: claim.id } },
      { $push: { sovereignCouponClaims: claim } }
    );
    if (result.matchedCount === 0) {
      const current = await collection.findOne(
        { _id: budget._id },
        { projection: { sovereignCouponClaims: 1 } }
      );
      const frozen = current?.sovereignCouponClaims?.find((row) => row.id === claim.id);
      if (!frozen || JSON.stringify(frozen) !== JSON.stringify(claim))
        throw new Error(`Sovereign coupon quote changed for ${claim.id}`);
      claimById.set(claim.id, frozen);
    } else claimById.set(claim.id, claim);
  }
  for (const claim of claimById.values()) {
    const attempt = Math.max(input.turn, claim.dueTurn);
    const attemptPrefix = `^${claim.id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}:attempt:`;
    const prior =
      (await db
        .collection("bankMoneyMoves")
        .findOne(
          { _id: { $regex: attemptPrefix }, status: "partial" },
          { projection: { _id: 1 } }
        )) ??
      (await db
        .collection("bankMoneyMoves")
        .findOne(
          { _id: { $regex: attemptPrefix }, status: "applied" },
          { projection: { _id: 1 } }
        ));
    if (!prior && !(await couponTargetsExist(db, claim))) continue;
    const result = prior
      ? await resumeSettlement(db, prior._id)
      : await settleTransition(
          db,
          payoutTransition(claim, String(budget._id), attempt, input.forexEnabled)
        );
    if (result.status === "partial") return;
    // A wholly rejected source guard has no landed cash leg. Keep the immutable claim for the next turn.
  }
}

async function couponTargetsExist(db: Db, claim: FundedSovereignCouponClaim): Promise<boolean> {
  const pools = claim.holders.filter((holder) => holder.kind === "publicFloat");
  if (pools.length > 0) {
    await db
      .collection("bondMarketPools")
      .updateOne(
        { _id: claim.currencyCode },
        { $setOnInsert: { targetCashLocal: 0, createdAt: new Date() } },
        { upsert: true }
      );
  }
  const collections = new Map<string, Set<string>>();
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
    const found = await db
      .collection<{ _id: ObjectId }>(collection)
      .find({ _id: { $in: [...ids].map((id) => new ObjectId(id)) } }, { projection: { _id: 1 } })
      .toArray();
    if (new Set(found.map((row) => row._id.toHexString())).size !== ids.size) return false;
  }
  return true;
}
