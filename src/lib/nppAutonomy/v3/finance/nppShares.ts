/**
 * NPP stock-buy command core (V3 full-agency finance).
 *
 * Lets an autonomous NPP buy individual shares from a corporation's public
 * float, mirroring the player buy path's money math (cost = shares ×
 * execution price, via the same `resolveShareExecutionPrice`/order-flow
 * eligibility rules) and crediting the position through the shareholder
 * ops' `nppId` holder variant.
 *
 * Scope constraint: NPPs only buy shares of corporations whose liquid
 * currency is their OWN home currency, so there's no FX leg — same
 * simplification `nppBuyBond` uses for bonds. The full player buy route
 * (811 lines) also handles buy-as-corporation, imperial characters,
 * explicit pay-currency conversion, hostile-takeover notifications, and
 * FX spread routing to central banks — none of that applies to an NPP
 * spending its own home-currency funds on a home-currency corp.
 *
 * Atomicity: deduct funds first (guarded findOneAndUpdate), then credit
 * shares with a guarded publicFloat check. If the float was taken between
 * the read and the credit, funds are refunded — no partial state. Calls
 * the same treasury-backed `applyFloatBuyCredit` the player path uses so
 * the purchase conserves money instead of the payment vanishing.
 */

import type { Db, ObjectId } from "mongodb";
import type { Corporation, NPP } from "@/lib/db/types";
import { creditSharesToNpp, debitSharesFromNpp } from "@/lib/corporations/shareholderOps";
import { isOrderFlowPriceEligible } from "@/lib/corporations/marketExecution";
import { loadEquityQuote } from "@/lib/equities/marketPool";
import {
  applyFloatBuyCredit,
  onFloatSellCommitted,
  reverseFloatSellDebit,
  settleFloatSellDebit,
} from "@/lib/corporations/shareEscrowSettlement";
import { COUNTRY_CURRENCY_MAP } from "@/lib/constants/currencies";
import { nppHomeFxRate, localToAnchor } from "./nppEconomicAccount";

export type NppShareBuyResult =
  | {
      ok: true;
      corporationId: string;
      shares: number;
      cost: number;
      costAnchor: number;
      investmentCashAnchor: number;
    }
  | { ok: false; reason: string };

export async function nppBuyShares(
  db: Db,
  npp: Pick<NPP, "_id" | "countryId">,
  corporationId: ObjectId,
  shares: number,
  /** Pre-loaded home FX rate (local per ₳); loaded on demand when omitted. */
  homeRate?: number
): Promise<NppShareBuyResult> {
  if (!Number.isInteger(shares) || shares <= 0) {
    return { ok: false, reason: "Shares must be a positive integer." };
  }

  const corp = await db.collection<Corporation>("corporations").findOne({ _id: corporationId });
  if (!corp) return { ok: false, reason: "Corporation not found." };
  if (corp.isPrivate) return { ok: false, reason: "Corporation is private." };
  if (corp.isNationalized) return { ok: false, reason: "Corporation is nationalized." };
  if (corp.countryOwnerId) {
    return { ok: false, reason: "National corporations are not open for equity investment." };
  }

  const publicFloat = corp.publicFloat ?? 0;
  if (publicFloat < shares) {
    return { ok: false, reason: `Only ${publicFloat} shares available in public float.` };
  }

  const homeCurrency = COUNTRY_CURRENCY_MAP[npp.countryId ?? "US"] ?? "USD";
  const corpCurrency = corp.liquidCurrencyCode ?? "USD";
  if (corpCurrency !== homeCurrency) {
    return { ok: false, reason: "NPPs only buy shares in their home currency." };
  }

  const executionPrice = (await loadEquityQuote(db, corp)).askPriceLocal;
  const orderFlowEligible = isOrderFlowPriceEligible(corp.publicFloat, corp.totalShares);
  const cost = Math.round(shares * executionPrice * 100) / 100;
  // Share price is LOCAL; the economic account is ₳ — convert at the FX boundary.
  const rate = homeRate ?? (await nppHomeFxRate(db, npp.countryId));
  const costAnchor = localToAnchor(cost, rate);
  const now = new Date();

  // Deduct from the personal forex account first (atomic guard), then credit
  // shares. NOT campaign `funds` — equity investing is real-economy.
  const deducted = await db
    .collection<NPP>("npps")
    .findOneAndUpdate(
      { _id: npp._id, nppInvestmentCashAnchor: { $gte: costAnchor } },
      { $inc: { nppInvestmentCashAnchor: -costAnchor }, $set: { updatedAt: now } },
      { returnDocument: "after" }
    );
  if (!deducted) {
    return { ok: false, reason: "Insufficient investment capital for share purchase." };
  }

  const credited = await creditSharesToNpp(
    db,
    corporationId,
    npp._id,
    shares,
    executionPrice,
    {
      $inc: {
        publicFloat: -shares,
        ...(orderFlowEligible ? { orderFlowWindowBuyValue: shares * executionPrice } : {}),
      },
      $set: { updatedAt: now },
    },
    { guardFilter: { publicFloat: { $gte: shares } } }
  );
  if (!credited) {
    // Float was taken between read and credit — refund and bail, no partial state.
    await db
      .collection<NPP>("npps")
      .updateOne(
        { _id: npp._id },
        { $inc: { nppInvestmentCashAnchor: costAnchor }, $set: { updatedAt: new Date() } }
      );
    return { ok: false, reason: "Share float no longer available; purchase refunded." };
  }

  // Treasury-backed market maker: the buyer's payment is injected into the
  // issuer's liquidCapital so a float buy conserves money instead of
  // vanishing, matching the player buy route.
  await applyFloatBuyCredit(db, corp, shares * executionPrice);

  return {
    ok: true,
    corporationId: corporationId.toString(),
    shares,
    cost,
    costAnchor,
    investmentCashAnchor: deducted.nppInvestmentCashAnchor ?? 0,
  };
}

/**
 * NPP stock-sell command core (V3 full-agency finance). Mirrors
 * `nppBuyShares`'s scope constraints in reverse: home-currency-only (the
 * corp's liquidCurrencyCode must already equal the NPP's home currency, so
 * proceeds need no FX conversion — same simplification as the buy side),
 * NPP-direct only (no corp-sell/imperial-sell paths, no shareOrders
 * reservation tracking since NPPs never place limit orders).
 *
 * Money flow mirrors the player sell route: the issuer settles the buyback
 * from its own treasury (instant mode, capped) or escrow (uncapped) BEFORE
 * shares are debited — if the debit then loses a float race, the issuer
 * settlement is rolled back, so there's never a state where proceeds are
 * paid out without the shares actually leaving the seller's position.
 */
export type NppShareSellResult =
  | {
      ok: true;
      corporationId: string;
      shares: number;
      proceeds: number;
      proceedsAnchor: number;
      investmentCashAnchor: number;
    }
  | { ok: false; reason: string };

export async function nppSellShares(
  db: Db,
  npp: Pick<NPP, "_id" | "countryId">,
  corporationId: ObjectId,
  shares: number,
  currentTurn: number,
  /** Pre-loaded home FX rate (local per ₳); loaded on demand when omitted. */
  homeRate?: number
): Promise<NppShareSellResult> {
  if (!Number.isInteger(shares) || shares <= 0) {
    return { ok: false, reason: "Shares must be a positive integer." };
  }

  const corp = await db.collection<Corporation>("corporations").findOne({ _id: corporationId });
  if (!corp) return { ok: false, reason: "Corporation not found." };
  if (corp.isPrivate) return { ok: false, reason: "Corporation is private." };
  if (corp.isNationalized) return { ok: false, reason: "Corporation is nationalized." };
  if (corp.countryOwnerId) {
    return { ok: false, reason: "National corporations are not open for equity trading." };
  }

  const homeCurrency = COUNTRY_CURRENCY_MAP[npp.countryId ?? "US"] ?? "USD";
  const corpCurrency = corp.liquidCurrencyCode ?? "USD";
  if (corpCurrency !== homeCurrency) {
    return { ok: false, reason: "NPPs only sell shares in their home currency." };
  }

  const ownedShares =
    corp.shareholders?.find((sh) => sh.nppId?.toString() === npp._id.toString())?.shares ?? 0;
  if (ownedShares < shares) {
    return { ok: false, reason: `Only ${ownedShares} shares owned.` };
  }

  const marketQuote = await loadEquityQuote(db, corp);
  const executionPrice = marketQuote.bidPriceLocal;
  if (marketQuote.active && shares > marketQuote.bidDepthShares) {
    return {
      ok: false,
      reason: `The ${marketQuote.currency} equity market can currently absorb ${marketQuote.bidDepthShares.toLocaleString("en-US")} shares.`,
    };
  }
  const orderFlowEligible = isOrderFlowPriceEligible(corp.publicFloat, corp.totalShares);
  const proceeds = Math.round(shares * executionPrice * 100) / 100;
  const rate = homeRate ?? (await nppHomeFxRate(db, npp.countryId));
  const proceedsAnchor = localToAnchor(proceeds, rate);
  const now = new Date();

  // Issuer settles the buyback BEFORE the seller's shares are debited,
  // matching the player sell route's ordering.
  const settled = await settleFloatSellDebit(db, corp, proceeds);
  if (!settled.ok) {
    return { ok: false, reason: "The equity market does not have enough cash for this sale." };
  }

  const shouldVacateCeo = corp.ceoId?.equals(npp._id) && ownedShares === shares;
  const corpUpdate = shouldVacateCeo
    ? {
        $inc: {
          publicFloat: shares,
          ...(orderFlowEligible ? { orderFlowWindowSellValue: shares * executionPrice } : {}),
        },
        $set: { ceoVacant: true, ceoVacantSinceTurn: currentTurn, updatedAt: now },
        $unset: { ceoId: "" as const },
      }
    : {
        $inc: {
          publicFloat: shares,
          ...(orderFlowEligible ? { orderFlowWindowSellValue: shares * executionPrice } : {}),
        },
        $set: { updatedAt: now },
      };

  const remaining = await debitSharesFromNpp(db, corporationId, npp._id, shares, corpUpdate, {
    requireSufficient: true,
  });
  if (remaining < 0) {
    // Float was taken/shares already sold between read and debit — undo the
    // issuer settlement, no partial state.
    await reverseFloatSellDebit(db, corp, proceeds, { split: settled.split });
    return { ok: false, reason: "Shares no longer available; sale reversed." };
  }

  const credited = await db
    .collection<NPP>("npps")
    .findOneAndUpdate(
      { _id: npp._id },
      { $inc: { nppInvestmentCashAnchor: proceedsAnchor }, $set: { updatedAt: now } },
      { returnDocument: "after" }
    );

  void onFloatSellCommitted(db, corp, proceeds);

  return {
    ok: true,
    corporationId: corporationId.toString(),
    shares,
    proceeds,
    proceedsAnchor,
    investmentCashAnchor: credited?.nppInvestmentCashAnchor ?? 0,
  };
}
