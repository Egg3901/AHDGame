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
 * Crash safety (issue #1672): the NPP cash debit, the guarded float
 * decrement, the cap-table credit, and the treasury-backed issuer credit
 * run as one keyed money flow (`nppShareTradeSpend`, reusing the shared
 * cash/cap/dealer steps). A process death at any durable boundary stays
 * resumable under the deterministic per-action key; guard rejection
 * compensates only the applied reversible prefix; the fire-and-forget
 * issuance writeback never fails the trade. There is no history, tx,
 * audit, or notification write on this path, same as before.
 */

import type { ClientSession, Db, ObjectId } from "mongodb";
import type { Corporation, NPP } from "@/lib/db/types";
import { isOrderFlowPriceEligible } from "@/lib/corporations/marketExecution";
import { loadEquityQuote } from "@/lib/equities/marketPool";
import { getShareBuybackMode } from "@/lib/corporations/shareBuybackMode";
import type { ShareOrderPlacementDealer } from "@/lib/corporations/shareOrderPlacement";
import { COUNTRY_CURRENCY_MAP } from "@/lib/constants/currencies";
import { nppHomeFxRate, localToAnchor } from "./nppEconomicAccount";
import {
  buildNppShareBuyKey,
  buildNppShareSellKey,
  executeNppShareTradeFlow,
  getNppShareTradeStoredPlan,
  getStoredNppShareTradeResponse,
  isNppShareTradeKeyReuse,
  mintNppShareTradeKey,
  recoverNppShareTradeByKey,
  type NppShareTradePlan,
} from "./nppShareTradeSpend";
import { MoneyFlowKeyConflictError } from "@/lib/db/nonAtomicMoneyFlow";

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

export interface NppShareTradeOptions {
  /** Turn scoping the deterministic per-action key. Omit for a minted key. */
  turn?: number;
  /** Explicit attempt key, overriding the deterministic build. */
  idempotencyKey?: string;
  /** Joins the keyed legs to the caller's transaction when present. */
  session?: ClientSession;
}

export async function nppBuyShares(
  db: Db,
  npp: Pick<NPP, "_id" | "countryId">,
  corporationId: ObjectId,
  shares: number,
  /** Pre-loaded home FX rate (local per anchor); loaded on demand when omitted. */
  homeRate?: number,
  opts: NppShareTradeOptions = {}
): Promise<NppShareBuyResult> {
  if (!Number.isInteger(shares) || shares <= 0) {
    return { ok: false, reason: "Shares must be a positive integer." };
  }

  const tradeKey =
    opts.idempotencyKey ??
    (opts.turn !== undefined
      ? buildNppShareBuyKey(opts.turn, npp._id, corporationId, shares)
      : mintNppShareTradeKey());

  // Same-key retry: the first attempt already validated, so reconcile
  // through the stored plan instead of re-running the guards (which
  // post-debit reads would fail). A key reused for a different transfer
  // fails closed here instead of returning the wrong stored outcome.
  if (await getStoredNppShareTradeResponse(db, tradeKey)) {
    const storedPlan = await getNppShareTradeStoredPlan(db, tradeKey);
    if (
      isNppShareTradeKeyReuse(storedPlan, {
        kind: "npp-buy",
        nppIdHex: npp._id.toHexString(),
        corpIdHex: corporationId.toHexString(),
        shares,
      })
    ) {
      throw new MoneyFlowKeyConflictError(tradeKey);
    }
    return mapTradeResult(
      await recoverNppShareTradeByKey(db, tradeKey, opts.session ? { session: opts.session } : {}),
      "buy"
    );
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

  const marketQuote = await loadEquityQuote(db, corp);
  const executionPrice = marketQuote.askPriceLocal;
  const orderFlowEligible = isOrderFlowPriceEligible(corp.publicFloat, corp.totalShares);
  const cost = Math.round(shares * executionPrice * 100) / 100;
  // Share price is LOCAL; the economic account is anchor — convert at the FX boundary.
  const rate = homeRate ?? (await nppHomeFxRate(db, npp.countryId));
  const costAnchor = localToAnchor(cost, rate);
  const now = new Date();
  const turn = opts.turn ?? 0;

  // Treasury-backed market maker routing, pinned before the flow starts
  // (mirrors `applyFloatBuyCredit`): pool counterparty when the quote is
  // pool-backed, else the issuer escrow or treasury leg.
  const issuerBuyback = shares * executionPrice;
  let dealer: ShareOrderPlacementDealer | null = null;
  if (marketQuote.active) {
    dealer = {
      kind: "pool",
      currency: marketQuote.currency,
      amountLocal: issuerBuyback,
      flowKind: "purchasesIn",
    };
  } else if (getShareBuybackMode(corp) === "escrow") {
    dealer = { kind: "escrow-credit", amountLocal: issuerBuyback };
  } else {
    dealer = { kind: "treasury", amountLocal: issuerBuyback };
  }

  const plan: NppShareTradePlan = {
    version: 1,
    tradeKey,
    kind: "npp-buy",
    nppIdHex: npp._id.toHexString(),
    corpIdHex: corporationId.toHexString(),
    shares,
    executionPrice,
    turn,
    nowIso: now.toISOString(),
    orderFlowEligible,
    cashLeg: {
      collection: "npps",
      idHex: npp._id.toHexString(),
      field: "nppInvestmentCashAnchor",
      amount: costAnchor,
    },
    capLeg: {
      field: "nppId",
      idHex: npp._id.toHexString(),
      pricePerShare: executionPrice,
    },
    dealer,
    issuerAmountLocal: issuerBuyback,
    ceoVacate: null,
    errors: {
      "npp-debit": { message: "Insufficient investment capital for share purchase.", status: 400 },
      float: { message: "Share float no longer available; purchase refunded.", status: 409 },
      "npp-credit": { message: "Failed to record trade", status: 500 },
      dealer: { message: "Failed to record trade", status: 500 },
      "seller-debit": { message: "Failed to record trade", status: 500 },
      "proceeds-credit": { message: "Failed to record trade", status: 500 },
    },
    response: {
      success: true,
      corporationId: corporationId.toString(),
      shares,
      cost,
      costAnchor,
    },
  };
  let result;
  try {
    result = await executeNppShareTradeFlow(db, plan, {
      idempotencyKey: tradeKey,
      ...(opts.session ? { session: opts.session } : {}),
    });
  } catch (error) {
    if (error instanceof MoneyFlowKeyConflictError) throw error;
    throw error;
  }
  return mapTradeResult(result, "buy");
}

function mapTradeResult(
  result:
    | { ok: true; body: Record<string, unknown>; replayed: boolean }
    | { ok: false; error: string; status: number },
  direction: "buy" | "sell"
): NppShareBuyResult | NppShareSellResult {
  if (!result.ok) {
    return { ok: false, reason: result.error };
  }
  const body = result.body;
  if (direction === "buy") {
    return {
      ok: true,
      corporationId: String(body.corporationId ?? ""),
      shares: Number(body.shares ?? 0),
      cost: Number(body.cost ?? 0),
      costAnchor: Number(body.costAnchor ?? 0),
      investmentCashAnchor: Number(body.investmentCashAnchor ?? 0),
    };
  }
  return {
    ok: true,
    corporationId: String(body.corporationId ?? ""),
    shares: Number(body.shares ?? 0),
    proceeds: Number(body.proceeds ?? 0),
    proceedsAnchor: Number(body.proceedsAnchor ?? 0),
    investmentCashAnchor: Number(body.investmentCashAnchor ?? 0),
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
 * Crash safety (issue #1672): the issuer buyback settlement, the NPP
 * cap-table debit, the float increment with the CEO-vacate mutation, and
 * the proceeds credit run as one keyed money flow, in the legacy order
 * (issuer first, then shares, then cash). Guard rejection compensates only
 * the applied reversible prefix; the post-commit issuance writeback never
 * fails the trade.
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
  /** Pre-loaded home FX rate (local per anchor); loaded on demand when omitted. */
  homeRate?: number,
  opts: NppShareTradeOptions = {}
): Promise<NppShareSellResult> {
  if (!Number.isInteger(shares) || shares <= 0) {
    return { ok: false, reason: "Shares must be a positive integer." };
  }

  const tradeKey =
    opts.idempotencyKey ??
    buildNppShareSellKey(opts.turn ?? currentTurn, npp._id, corporationId, shares);

  // Same-key retry: reconcile through the stored plan, never re-validate
  // against post-debit reads. A reused key fails closed.
  if (await getStoredNppShareTradeResponse(db, tradeKey)) {
    const storedPlan = await getNppShareTradeStoredPlan(db, tradeKey);
    if (
      isNppShareTradeKeyReuse(storedPlan, {
        kind: "npp-sell",
        nppIdHex: npp._id.toHexString(),
        corpIdHex: corporationId.toHexString(),
        shares,
      })
    ) {
      throw new MoneyFlowKeyConflictError(tradeKey);
    }
    return mapTradeResult(
      await recoverNppShareTradeByKey(db, tradeKey, opts.session ? { session: opts.session } : {}),
      "sell"
    ) as NppShareSellResult;
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

  // Issuer buyback routing, pinned before the flow starts (mirrors
  // `settleFloatSellDebit`): pool-gated when the quote is pool-backed,
  // floored escrow split in escrow mode (never blocks), gated treasury
  // otherwise.
  const issuerBuyback = shares * executionPrice;
  let dealer: ShareOrderPlacementDealer;
  let dealerError = "The equity market does not have enough cash for this sale.";
  if (marketQuote.active) {
    dealer = {
      kind: "pool",
      currency: marketQuote.currency,
      amountLocal: -issuerBuyback,
      flowKind: "salesOut",
    };
    dealerError = `The ${marketQuote.currency} equity market can currently absorb ${marketQuote.bidDepthShares.toLocaleString("en-US")} shares.`;
  } else if (getShareBuybackMode(corp) === "escrow") {
    const issuerRow = await db
      .collection<Corporation>("corporations")
      .findOne({ _id: corporationId }, { projection: { shareEscrowBalance: 1 } });
    const escrowBalance = issuerRow?.shareEscrowBalance ?? 0;
    const escrowPart = Math.min(issuerBuyback, Math.max(0, escrowBalance));
    dealer = {
      kind: "escrow-split",
      amountLocal: issuerBuyback,
      escrowPart,
      treasuryPart: issuerBuyback - escrowPart,
    };
    dealerError = "Failed to record trade";
  } else {
    dealer = { kind: "treasury", amountLocal: -issuerBuyback };
  }

  const shouldVacateCeo = corp.ceoId?.equals(npp._id) && ownedShares === shares;
  const plan: NppShareTradePlan = {
    version: 1,
    tradeKey,
    kind: "npp-sell",
    nppIdHex: npp._id.toHexString(),
    corpIdHex: corporationId.toHexString(),
    shares,
    executionPrice,
    turn: currentTurn,
    nowIso: now.toISOString(),
    orderFlowEligible,
    cashLeg: {
      collection: "npps",
      idHex: npp._id.toHexString(),
      field: "nppInvestmentCashAnchor",
      amount: proceedsAnchor,
    },
    capLeg: {
      field: "nppId",
      idHex: npp._id.toHexString(),
      pricePerShare: executionPrice,
    },
    dealer,
    issuerAmountLocal: proceeds,
    ceoVacate: shouldVacateCeo
      ? {
          ceoIdHex: corp.ceoId!.toHexString(),
          ceoVacant: corp.ceoVacant ?? false,
          ...(corp.ceoVacantSinceTurn !== undefined
            ? { ceoVacantSinceTurn: corp.ceoVacantSinceTurn }
            : {}),
        }
      : null,
    errors: {
      "npp-debit": { message: "Failed to record trade", status: 500 },
      float: { message: "Failed to record trade", status: 500 },
      "npp-credit": { message: "Failed to record trade", status: 500 },
      dealer: { message: dealerError, status: 400 },
      "seller-debit": { message: "Shares no longer available; sale reversed.", status: 409 },
      "proceeds-credit": { message: "Failed to record trade", status: 500 },
    },
    response: {
      success: true,
      corporationId: corporationId.toString(),
      shares,
      proceeds,
      proceedsAnchor,
    },
  };

  let result;
  try {
    result = await executeNppShareTradeFlow(db, plan, {
      idempotencyKey: tradeKey,
      ...(opts.session ? { session: opts.session } : {}),
    });
  } catch (error) {
    if (error instanceof MoneyFlowKeyConflictError) throw error;
    throw error;
  }
  return mapTradeResult(result, "sell") as NppShareSellResult;
}
