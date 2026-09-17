/**
 * Redemption liquidity: sell fund-held shares back to issuer public float so
 * NPPs, other funds, and players can absorb them (mirror of absorption buys).
 *
 * Crash-safety shape (issue #1672): every sale runs through the
 * `fundShareSellSpend` primitive under a deterministic caller key, and the
 * multi-sale pass pins its full leg sequence on a parent receipt before the
 * first sale. A same-key retry replays the stored legs (completed legs
 * reconcile as duplicates and reduce the remaining need) instead of
 * recomputing from post-sale state, so a resumed liquidation cannot sell the
 * same shares twice or over-raise cash because earlier legs already landed.
 */

import { randomUUID } from "node:crypto";
import { ObjectId } from "mongodb";
import type { ClientSession, Collection, Db } from "mongodb";
import type { Corporation, IndexFund } from "@/lib/db/types";
import {
  isOrderFlowPriceEligible,
  resolveShareExecutionPrice,
} from "@/lib/corporations/marketExecution";
import { recordShareTrade } from "@/lib/corporations/shareTradeHistory";
import { getShareBuybackMode } from "@/lib/corporations/shareBuybackMode";
import { getCurrentTurn } from "@/lib/turn/currentTurn";
import { equityPoolCurrency, loadEquityQuote } from "@/lib/equities/marketPool";
import type { LoadedEquityQuote } from "@/lib/equities/marketPool";
import {
  fxRateForCorpFromMap,
  loadFxRatesByCurrency,
  resolveCorpLiquidCurrencyCode,
  shareTradeAnchorValue,
} from "@/lib/currency/corporationCapital";
import {
  applyFundShareSellSpend,
  buildFundShareSellFingerprint,
  buildFundShareSellKey,
  FUND_SHARE_SELL_ISSUER,
  FUND_SHARE_SELL_RELEASE,
  type FundShareSellCounterparty,
  type FundShareSellIssuerRoute,
  type FundShareSellOutcome,
} from "@/lib/indexFunds/fundShareSellSpend";
import { getMoneyFlowReceiptsCollection } from "@/lib/db/collections/moneyFlowReceipts";
import {
  claimMoneyFlowReceipt,
  deriveMoneyFlowKey,
  failMoneyFlowReceipt,
  MoneyFlowKeyConflictError,
  type MoneyFlowReceipt,
} from "@/lib/db/nonAtomicMoneyFlow";
import { runWithOptionalTransaction } from "@/lib/db/runWithOptionalTransaction";
import type { CurrencyCode } from "@/lib/constants/currencies";

export type HoldingSaleInput = {
  corporationId: ObjectId;
  shares: number;
  pricePerShareAnchor: number;
  /** Finite currency-pool bid depth available for this holding right now. */
  maxShares?: number;
};

export type HoldingSalePlan = HoldingSaleInput & {
  sharesToSell: number;
  proceedsAnchor: number;
};

/** Plan proportional share sales to raise up to `cashNeededAnchor` (round down). */
export function planProportionalHoldingsSale(
  holdings: HoldingSaleInput[],
  cashNeededAnchor: number
): HoldingSalePlan[] {
  if (!Number.isFinite(cashNeededAnchor) || cashNeededAnchor <= 0) return [];

  const eligible = holdings.filter(
    (h) => h.shares > 0 && Number.isFinite(h.pricePerShareAnchor) && h.pricePerShareAnchor > 0
  );
  if (eligible.length === 0) return [];

  const sellableShares = (h: HoldingSaleInput) =>
    Math.max(0, Math.min(Math.floor(h.shares), h.maxShares ?? Number.MAX_SAFE_INTEGER));
  const totalValue = eligible.reduce(
    (sum, h) => sum + sellableShares(h) * h.pricePerShareAnchor,
    0
  );
  if (totalValue <= 0) return [];

  if (cashNeededAnchor >= totalValue) {
    return eligible.map((h) => ({
      ...h,
      sharesToSell: sellableShares(h),
      proceedsAnchor: sellableShares(h) * h.pricePerShareAnchor,
    }));
  }

  const plans: HoldingSalePlan[] = [];
  let remainingCash = cashNeededAnchor;

  const targets = eligible.map((h) => ({
    ...h,
    holdingValue: sellableShares(h) * h.pricePerShareAnchor,
    targetProceeds: (cashNeededAnchor * sellableShares(h) * h.pricePerShareAnchor) / totalValue,
  }));

  const soldByCorp = new Map<string, number>();

  for (const target of targets) {
    const sharesToSell = Math.min(
      sellableShares(target),
      Math.floor(target.targetProceeds / target.pricePerShareAnchor)
    );
    if (sharesToSell <= 0) continue;
    const proceedsAnchor = sharesToSell * target.pricePerShareAnchor;
    plans.push({
      corporationId: target.corporationId,
      shares: target.shares,
      pricePerShareAnchor: target.pricePerShareAnchor,
      sharesToSell,
      proceedsAnchor,
    });
    soldByCorp.set(target.corporationId.toString(), sharesToSell);
    remainingCash -= proceedsAnchor;
  }

  // Assign remainder one share at a time (largest holdings first).
  const byValue = [...eligible].sort(
    (a, b) => sellableShares(b) * b.pricePerShareAnchor - sellableShares(a) * a.pricePerShareAnchor
  );

  while (remainingCash > 0) {
    let assigned = false;
    for (const holding of byValue) {
      const key = holding.corporationId.toString();
      const alreadySold = soldByCorp.get(key) ?? 0;
      const remainingShares = sellableShares(holding) - alreadySold;
      if (remainingShares <= 0) continue;
      if (holding.pricePerShareAnchor > remainingCash + 1e-9) continue;

      const existing = plans.find((p) => p.corporationId.toString() === key);
      if (existing) {
        existing.sharesToSell += 1;
        existing.proceedsAnchor += holding.pricePerShareAnchor;
        soldByCorp.set(key, existing.sharesToSell);
      } else {
        plans.push({
          corporationId: holding.corporationId,
          shares: holding.shares,
          pricePerShareAnchor: holding.pricePerShareAnchor,
          sharesToSell: 1,
          proceedsAnchor: holding.pricePerShareAnchor,
        });
        soldByCorp.set(key, 1);
      }
      remainingCash -= holding.pricePerShareAnchor;
      assigned = true;
      break;
    }
    if (!assigned) break;
  }

  return plans.filter((p) => p.sharesToSell > 0);
}

// The holdings-image formula lives with the sale primitive so the step and
// any future caller share one definition; re-exported here for compatibility.
export { updateHoldingAfterSale } from "@/lib/indexFunds/fundShareSellSpend";

export type SellHoldingsForRedemptionResult = {
  cashRaisedAnchor: number;
  sharesSold: number;
  salesExecuted: number;
};

type CorpQuoteRow = Pick<
  Corporation,
  | "_id"
  | "name"
  | "sharePrice"
  | "fundamentalSharePrice"
  | "publicFloat"
  | "totalShares"
  | "liquidCurrencyCode"
  | "countryId"
  | "shareBuybackMode"
> & {
  shareEscrowBalance?: number | null;
};

/** One pinned sale leg of a redemption-liquidity pass. */
export interface SellPassLeg {
  corporationId: ObjectId;
  sharesToSell: number;
  executionPriceLocal: number;
  pricePerShareAnchor: number;
  proceedsAnchor: number;
  issuerDebitLocal: number;
  escrowDebited: number;
  treasuryDebited: number;
  orderFlowEligible: boolean;
  currency: CurrencyCode;
  issuerRoute: FundShareSellIssuerRoute;
  counterparty: FundShareSellCounterparty;
  corpCurrencyCode: string | undefined;
  holdingAvgCostAnchor: number | null;
  /** True when the sale empties the position (drives the post-commit row sweep). */
  emptiedHolding: boolean;
  note: string;
  turn: number;
}

interface SellPassOutcome {
  cashRaisedAnchor: number;
  sharesSold: number;
  salesExecuted: number;
}

interface SellPassStoredPlan {
  version: 1;
  fundIdHex: string;
  cashNeededAnchor: number;
  turn: number;
  nowIso: string;
  legs: Array<
    Omit<SellPassLeg, "corporationId"> & {
      corporationIdHex: string;
    }
  >;
  outcome?: SellPassOutcome;
}

/** Receipt rows carry the pass resume plan under this field (never in the shared type). */
type SellPassReceipt = MoneyFlowReceipt & { fundShareSellPassPlan?: unknown };

function isSellPassOutcome(value: unknown): value is SellPassOutcome {
  if (!value || typeof value !== "object") return false;
  const outcome = value as Record<string, unknown>;
  return (
    typeof outcome.cashRaisedAnchor === "number" &&
    typeof outcome.sharesSold === "number" &&
    typeof outcome.salesExecuted === "number"
  );
}

function isSellPassPlan(value: unknown): value is SellPassStoredPlan {
  if (!value || typeof value !== "object") return false;
  const plan = value as Record<string, unknown>;
  return (
    plan.version === 1 &&
    typeof plan.fundIdHex === "string" &&
    typeof plan.cashNeededAnchor === "number" &&
    Array.isArray(plan.legs)
  );
}

function legToStored(leg: SellPassLeg): SellPassStoredPlan["legs"][number] {
  const { corporationId, ...rest } = leg;
  return { ...rest, corporationIdHex: corporationId.toHexString() };
}

function legFromStored(stored: SellPassStoredPlan["legs"][number]): SellPassLeg {
  const { corporationIdHex, ...rest } = stored;
  return { ...rest, corporationId: new ObjectId(corporationIdHex) };
}

function cents(n: number): string {
  return String(Math.round(n * 100) / 100);
}

/**
 * Deterministic fingerprint for one liquidation pass. Covers the fund, the
 * turn, the cash need, and the note: the same liquidation retried under the
 * same key must present the same fingerprint even though the live market
 * moved, so the claim reconciles to the stored legs instead of conflicting.
 * The legs are the stored payload, not the identity: each sale still carries
 * its own fingerprint under its sub-key, so a sub-key reused for different
 * figures fails closed there. A parent key reused for a different need or
 * note is a different liquidation and stays a `MoneyFlowKeyConflictError`.
 */
function buildSellPassFingerprint(
  fundId: ObjectId,
  turn: number,
  cashNeededAnchor: number,
  note: string
): string {
  return [
    "fund-share-sell-pass",
    fundId.toHexString(),
    `turn:${turn}`,
    `need:${cents(cashNeededAnchor)}`,
    `note:${note}`,
  ].join(":");
}

function isSkipSellError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : "";
  return message.startsWith(FUND_SHARE_SELL_ISSUER) || message.startsWith(FUND_SHARE_SELL_RELEASE);
}

/**
 * Post-commit side effects for one landed sale (issue #1672): the
 * trade-history log and the zero-share registry sweep. Both are best effort
 * and run only for the fresh attempt, never on a same-key replay (which
 * already fired them). The sweep spares a concurrently re-bought row (shares
 * above zero), where the legacy unconditional pull would have removed it.
 */
async function fireSellPostCommit(
  db: Db,
  fundName: string,
  fundId: ObjectId,
  leg: SellPassLeg,
  outcome: FundShareSellOutcome,
  sessionOpts: { session?: ClientSession }
): Promise<void> {
  void recordShareTrade(db, {
    corporationId: leg.corporationId,
    kind: "market_sell",
    turn: leg.turn,
    shares: outcome.sharesSold,
    pricePerShareAnchor: outcome.sharesSold > 0 ? outcome.cashRaisedAnchor / outcome.sharesSold : 0,
    from: { name: `${fundName} (index fund)` },
    to: null,
    corpCurrencyCode: leg.corpCurrencyCode ?? undefined,
    note: leg.note,
  });
  if (!leg.emptiedHolding) return;
  try {
    await db
      .collection("corporations")
      .updateOne(
        { _id: leg.corporationId },
        { $pull: { shareholders: { fundId, shares: { $lte: 0 } } } },
        sessionOpts.session ? { session: sessionOpts.session } : undefined
      );
  } catch {
    // Best effort: a lingering zero-share row matches no sufficiency guard.
  }
}

/** Run one pinned leg through the primitive under its idempotency key. */
async function applySellLeg(
  db: Db,
  fundName: string,
  fundId: ObjectId,
  legKey: string,
  leg: SellPassLeg,
  sessionOpts: { session?: ClientSession }
): Promise<{ duplicate: boolean; outcome: FundShareSellOutcome }> {
  const result = await applyFundShareSellSpend(
    db,
    {
      fundId,
      corpId: leg.corporationId,
      sharesToSell: leg.sharesToSell,
      executionPriceLocal: leg.executionPriceLocal,
      pricePerShareAnchor: leg.pricePerShareAnchor,
      proceedsAnchor: leg.proceedsAnchor,
      issuerDebitLocal: leg.issuerDebitLocal,
      escrowDebited: leg.escrowDebited,
      treasuryDebited: leg.treasuryDebited,
      orderFlowEligible: leg.orderFlowEligible,
      currency: leg.currency,
      issuerRoute: leg.issuerRoute,
      counterparty: leg.counterparty,
      holdingAvgCostAnchor: leg.holdingAvgCostAnchor,
      note: leg.note,
      turn: leg.turn,
      fingerprint: buildFundShareSellFingerprint({
        fundId,
        corpId: leg.corporationId,
        sharesToSell: leg.sharesToSell,
        executionPriceLocal: leg.executionPriceLocal,
        pricePerShareAnchor: leg.pricePerShareAnchor,
        proceedsAnchor: leg.proceedsAnchor,
        issuerDebitLocal: leg.issuerDebitLocal,
        escrowDebited: leg.escrowDebited,
        treasuryDebited: leg.treasuryDebited,
        orderFlowEligible: leg.orderFlowEligible,
        currency: leg.currency,
        issuerRoute: leg.issuerRoute,
        counterparty: leg.counterparty,
        holdingAvgCostAnchor: leg.holdingAvgCostAnchor,
        note: leg.note,
        turn: leg.turn,
      }),
      idempotencyKey: legKey,
    },
    sessionOpts.session ? { session: sessionOpts.session } : undefined
  );
  if (!result.duplicate) {
    await fireSellPostCommit(db, fundName, fundId, leg, result.outcome, sessionOpts);
  }
  return result;
}

/**
 * Sell fund holdings into public float until `cashNeededAnchor` is raised or
 * sales are exhausted (issuer treasury may block individual corps).
 *
 * Crash-safe pass driver (issue #1672) over the `applyFundShareSellSpend`
 * primitive: the pass owns selection and sequencing (corp reads, bid quotes,
 * FX conversion, proportional planning, the cash cap), pins every computed
 * figure per leg on a parent receipt before the first sale, and maps the
 * sentinel failures back onto the historical partial-tally surface. A lost
 * issuer or float race skips the leg exactly like the legacy null-and-
 * continue did; anything later throws after the applied prefix compensates.
 * A same-key retry replays the stored legs instead of recomputing from
 * post-sale state: completed legs reconcile as duplicates and reduce the
 * remaining need, so the pass cannot sell the same shares twice or
 * over-raise cash because earlier legs already landed.
 */
export async function sellFundHoldingsForRedemptionCash(
  db: Db,
  fund: IndexFund,
  cashNeededAnchor: number,
  options?: {
    session?: ClientSession;
    note?: string;
    corporationIds?: import("mongodb").ObjectId[];
    idempotencyKey?: string;
  }
): Promise<SellHoldingsForRedemptionResult> {
  const zeros: SellHoldingsForRedemptionResult = {
    cashRaisedAnchor: 0,
    sharesSold: 0,
    salesExecuted: 0,
  };
  if (!Number.isFinite(cashNeededAnchor) || cashNeededAnchor <= 0 || fund.holdings.length === 0) {
    return zeros;
  }

  const note = options?.note ?? "Redemption liquidity";
  const filterSet = options?.corporationIds
    ? new Set(options.corporationIds.map((id) => id.toString()))
    : null;
  const holdingsToSell = filterSet
    ? fund.holdings.filter((h) => filterSet.has(h.corporationId.toString()))
    : fund.holdings;
  if (holdingsToSell.length === 0) {
    return zeros;
  }

  const corpIds = holdingsToSell.map((h) => h.corporationId);
  const corps = (await db
    .collection<CorpQuoteRow>("corporations")
    .find({ _id: { $in: corpIds } })
    .project({
      _id: 1,
      name: 1,
      sharePrice: 1,
      fundamentalSharePrice: 1,
      publicFloat: 1,
      totalShares: 1,
      liquidCurrencyCode: 1,
      countryId: 1,
      shareBuybackMode: 1,
      shareEscrowBalance: 1,
    })
    .toArray()) as CorpQuoteRow[];
  const corpMap = new Map(corps.map((c) => [c._id.toString(), c]));

  const fxByCurrency = await loadFxRatesByCurrency(db);
  const pricedHoldings: Array<
    HoldingSaleInput & {
      executionPriceLocal: number;
      quoteActive: boolean;
      preEscrow: number;
    }
  > = [];
  for (const holding of holdingsToSell) {
    const corp = corpMap.get(holding.corporationId.toString());
    if (!corp) continue;
    const quote = await loadEquityQuote(db, corp);
    const executionPrice = quote.bidPriceLocal;
    if (!Number.isFinite(executionPrice) || executionPrice <= 0) continue;
    const fxRate = fxRateForCorpFromMap(corp, fxByCurrency);
    const pricePerShareAnchor = shareTradeAnchorValue(
      1,
      { ...corp, sharePrice: executionPrice },
      fxRate
    );
    if (pricePerShareAnchor <= 0) continue;
    pricedHoldings.push({
      corporationId: holding.corporationId,
      shares: holding.shares,
      pricePerShareAnchor,
      maxShares: quote.active ? quote.bidDepthShares : undefined,
      executionPriceLocal: executionPrice,
      quoteActive: quote.active,
      preEscrow: corp.shareEscrowBalance ?? 0,
    });
  }

  const plan = filterSet
    ? pricedHoldings.map((h) => ({
        ...h,
        sharesToSell: Math.min(Math.floor(h.shares), h.maxShares ?? Number.MAX_SAFE_INTEGER),
        proceedsAnchor:
          Math.min(Math.floor(h.shares), h.maxShares ?? Number.MAX_SAFE_INTEGER) *
          h.pricePerShareAnchor,
      }))
    : planProportionalHoldingsSale(pricedHoldings, cashNeededAnchor);
  if (plan.length === 0) {
    return zeros;
  }

  const turn = await getCurrentTurn(db);
  const now = new Date();
  const parentKey = options?.idempotencyKey !== undefined ? options.idempotencyKey : randomUUID();
  if (parentKey.length === 0 || parentKey.length > 128) {
    throw new RangeError("Fund share sale pass idempotency key must be 1-128 characters");
  }

  // Pin every leg figure once, before any mutable write. A same-key retry
  // replays these pins (never a fresh quote over post-sale state).
  const liveLegs: SellPassLeg[] = [];
  for (const sale of plan) {
    const corp = corpMap.get(sale.corporationId.toString());
    if (!corp) continue;
    const priced = pricedHoldings.find(
      (p) => p.corporationId.toString() === sale.corporationId.toString()
    );
    if (!priced) continue;
    const issuerRoute: FundShareSellIssuerRoute = priced.quoteActive
      ? "pool"
      : getShareBuybackMode(corp) === "escrow"
        ? "escrow"
        : "liquid";
    const issuerDebitLocal = sale.sharesToSell * priced.executionPriceLocal;
    const escrowDebited =
      issuerRoute === "escrow" ? Math.min(issuerDebitLocal, Math.max(0, priced.preEscrow)) : 0;
    const treasuryDebited = issuerRoute === "escrow" ? issuerDebitLocal - escrowDebited : 0;
    const fxRate = fxRateForCorpFromMap(corp, fxByCurrency);
    const proceedsAnchor =
      Math.round(
        shareTradeAnchorValue(
          sale.sharesToSell,
          { ...corp, sharePrice: priced.executionPriceLocal },
          fxRate
        ) * 100
      ) / 100;
    const holding = fund.holdings.find(
      (h) => h.corporationId.toString() === sale.corporationId.toString()
    );
    liveLegs.push({
      corporationId: sale.corporationId,
      sharesToSell: sale.sharesToSell,
      executionPriceLocal: priced.executionPriceLocal,
      pricePerShareAnchor: sale.pricePerShareAnchor,
      proceedsAnchor,
      issuerDebitLocal,
      escrowDebited,
      treasuryDebited,
      orderFlowEligible: isOrderFlowPriceEligible(corp.publicFloat, corp.totalShares),
      currency: equityPoolCurrency({
        countryId: corp.countryId,
        liquidCurrencyCode: corp.liquidCurrencyCode ?? undefined,
      }),
      issuerRoute,
      counterparty: "market",
      corpCurrencyCode: resolveCorpLiquidCurrencyCode(corp),
      holdingAvgCostAnchor: holding?.avgCostPerShareAnchor ?? null,
      emptiedHolding: (holding?.shares ?? 0) - sale.sharesToSell <= 0,
      note,
      turn,
    });
  }
  if (liveLegs.length === 0) {
    return zeros;
  }
  const fingerprint = buildSellPassFingerprint(fund._id, turn, cashNeededAnchor, note);

  const runPass = async (session?: ClientSession) => {
    const sessionOpts = session ? { session } : {};
    const receipts = await getMoneyFlowReceiptsCollection(db);
    const receiptCollection = receipts as unknown as Collection<SellPassReceipt>;
    let claim: Awaited<ReturnType<typeof claimMoneyFlowReceipt>>;
    try {
      claim = await claimMoneyFlowReceipt(receipts, parentKey, fingerprint, sessionOpts);
    } catch (err) {
      if (!(err instanceof MoneyFlowKeyConflictError)) throw err;
      // Same key, different liquidation: a genuinely different pass reusing
      // the key, not a post-crash remainder. Fail closed.
      throw err;
    }
    if (claim === "duplicate") {
      const existing = await receiptCollection.findOne({ _id: parentKey }, sessionOpts);
      const stored = existing?.fundShareSellPassPlan;
      if (!isSellPassPlan(stored) || !isSellPassOutcome(stored.outcome)) {
        throw new Error("MONEY_FLOW_RECEIPT_LOST");
      }
      return { ...stored.outcome };
    }
    let legsToRun = liveLegs;
    if (claim === "in-progress") {
      // Same fingerprint, so the live legs name the same liquidation, but
      // the pass runs the STORED legs when they exist: post-sale quotes
      // would replan different sizes and strand the landed legs' cash
      // outside the remaining need. No stored plan means the crash landed
      // between the claim insert and the plan write below (nothing applied
      // yet), so the live legs under the stored fingerprint are exact.
      const existing = await receiptCollection.findOne({ _id: parentKey }, sessionOpts);
      const stored = existing?.fundShareSellPassPlan;
      if (isSellPassPlan(stored)) {
        legsToRun = stored.legs.map(legFromStored);
      }
    } else {
      // A fresh claim owns the pass. Persist the leg sequence before the
      // first sale: a crash from here on replays this exact sequence under
      // the same key.
      try {
        await receiptCollection.updateOne(
          { _id: parentKey },
          {
            $set: {
              fundShareSellPassPlan: {
                version: 1,
                fundIdHex: fund._id.toHexString(),
                cashNeededAnchor,
                turn,
                nowIso: now.toISOString(),
                legs: liveLegs.map(legToStored),
              } satisfies SellPassStoredPlan,
              updatedAt: new Date(),
            },
          },
          sessionOpts
        );
      } catch (planError) {
        await failMoneyFlowReceipt(
          receipts,
          parentKey,
          `${FUND_SHARE_SELL_RELEASE}:pass-plan-store`,
          sessionOpts
        );
        throw planError;
      }
    }

    let cashRaisedAnchor = 0;
    let sharesSold = 0;
    let salesExecuted = 0;
    for (const leg of legsToRun) {
      if (cashRaisedAnchor >= cashNeededAnchor) break;
      // One deterministic sub-key per leg: fund is fixed by the parent, so
      // corp + shares names the sale within this liquidation.
      const legKey = deriveMoneyFlowKey(
        parentKey,
        "equity",
        leg.corporationId.toHexString(),
        String(leg.sharesToSell)
      );
      let result: Awaited<ReturnType<typeof applySellLeg>>;
      try {
        result = await applySellLeg(db, fund.name, fund._id, legKey, leg, sessionOpts);
      } catch (err) {
        // A lost issuer or float race skips the leg like the legacy
        // null-and-continue; a key reused for a different leg skips it the
        // way the rebalance buy loop skips a conflicting leg. Anything later
        // aborts the pass after its own prefix compensates (that leg moved
        // no net money, and landed legs stand as independent sales).
        if (isSkipSellError(err) || err instanceof MoneyFlowKeyConflictError) continue;
        await failMoneyFlowReceipt(
          receipts,
          parentKey,
          err instanceof Error ? err.message : String(err),
          sessionOpts
        );
        throw err;
      }
      cashRaisedAnchor += result.outcome.cashRaisedAnchor;
      sharesSold += result.outcome.sharesSold;
      salesExecuted++;
    }

    // One atomic settle: the outcome lands with the `completed` status, so
    // no crash window separates them.
    const outcome: SellPassOutcome = { cashRaisedAnchor, sharesSold, salesExecuted };
    const storedPlan = await receiptCollection.findOne({ _id: parentKey }, sessionOpts);
    const settledLegs = isSellPassPlan(storedPlan?.fundShareSellPassPlan)
      ? storedPlan.fundShareSellPassPlan.legs
      : legsToRun.map(legToStored);
    await receiptCollection.updateOne(
      { _id: parentKey },
      {
        $set: {
          status: "completed",
          fundShareSellPassPlan: {
            version: 1,
            fundIdHex: fund._id.toHexString(),
            cashNeededAnchor,
            turn,
            nowIso: now.toISOString(),
            legs: settledLegs,
            outcome,
          } satisfies SellPassStoredPlan,
          updatedAt: new Date(),
        },
      },
      sessionOpts
    );
    return outcome;
  };

  // Join the caller's transaction when one is in flight (the redemption
  // route runs the pass inside its payout transaction); otherwise manage our
  // own. Never open a nested transaction around an outer session.
  if (options?.session) return runPass(options.session);
  return runWithOptionalTransaction(
    async (session) => runPass(session ?? undefined),
    async () => runPass()
  );
}

// ── Pure sale-figure quoter ───────────────────────────────────────────────────

/** Everything ambient the sale figures derive from, read by the caller. */
export type FundHoldingSaleQuoteInput = {
  holding: Pick<IndexFund["holdings"][number], "shares" | "avgCostPerShareAnchor">;
  corp: CorpQuoteRow;
  quote: LoadedEquityQuote;
  fxRate: number;
  maxShares: number;
  note: string;
  turn: number;
  settlementCounterparty?: "market" | "issuer";
};

/**
 * Pure sale-figure quoter (issue #1672): the exact figure assembly
 * `sellFundHoldingShares` always used, factored out so a pass driver can pin
 * every figure (shares, prices, proceeds, issuer split, route, counterparty,
 * average) before the first mutable write. A same-key retry replays the
 * pinned leg instead of repricing from post-sale pool state, so the child
 * fingerprint stays stable even when holdings, prices, or FX moved. Returns
 * `null` exactly where the shell historically returned zeros.
 */
export function quoteFundHoldingSaleFigures(input: FundHoldingSaleQuoteInput): SellPassLeg | null {
  const { holding, corp, quote, fxRate, maxShares, note, turn } = input;
  const issuerFunded = input.settlementCounterparty === "issuer";
  const sharesToSell = Math.min(
    maxShares,
    Math.floor(holding.shares),
    issuerFunded || !quote.active ? Number.MAX_SAFE_INTEGER : quote.bidDepthShares
  );
  if (sharesToSell <= 0) {
    return null;
  }

  const executionPrice = issuerFunded ? resolveShareExecutionPrice(corp) : quote.bidPriceLocal;
  if (!Number.isFinite(executionPrice) || executionPrice <= 0) {
    return null;
  }

  const pricePerShareAnchor = shareTradeAnchorValue(
    1,
    { ...corp, sharePrice: executionPrice },
    fxRate
  );
  if (pricePerShareAnchor <= 0) {
    return null;
  }

  const issuerRoute: FundShareSellIssuerRoute =
    !issuerFunded && quote.active
      ? "pool"
      : getShareBuybackMode(corp) === "escrow"
        ? "escrow"
        : "liquid";
  const issuerDebitLocal = sharesToSell * executionPrice;
  const escrowDebited =
    issuerRoute === "escrow"
      ? Math.min(issuerDebitLocal, Math.max(0, corp.shareEscrowBalance ?? 0))
      : 0;
  const treasuryDebited = issuerRoute === "escrow" ? issuerDebitLocal - escrowDebited : 0;
  const proceedsAnchor =
    Math.round(
      shareTradeAnchorValue(sharesToSell, { ...corp, sharePrice: executionPrice }, fxRate) * 100
    ) / 100;
  return {
    corporationId: corp._id,
    sharesToSell,
    executionPriceLocal: executionPrice,
    pricePerShareAnchor,
    proceedsAnchor,
    issuerDebitLocal,
    escrowDebited,
    treasuryDebited,
    orderFlowEligible: isOrderFlowPriceEligible(corp.publicFloat, corp.totalShares),
    currency: equityPoolCurrency({
      countryId: corp.countryId,
      liquidCurrencyCode: corp.liquidCurrencyCode ?? undefined,
    }),
    issuerRoute,
    counterparty: issuerFunded ? "issuer" : "market",
    corpCurrencyCode: resolveCorpLiquidCurrencyCode(corp),
    holdingAvgCostAnchor: holding.avgCostPerShareAnchor ?? null,
    emptiedHolding: holding.shares - sharesToSell <= 0,
    note,
    turn,
  };
}

// ── sellFundHoldingShares ─────────────────────────────────────────────────────

/**
 * Sell exactly `min(maxShares, held)` shares of ONE corporation back to the
 * public float.
 *
 * Crash-safe command shell (issue #1672) over the `applyFundShareSellSpend`
 * primitive: this shell owns everything ambient (the bid quote, the FX
 * conversion, the order-flow eligibility read, the issuer-route decision,
 * the escrow split), pins every computed figure into the primitive input,
 * and maps the sentinel failures back onto the historical zeros surface. A
 * lost issuer or float race returns zeros exactly like the legacy guarded
 * writes did; anything later throws after the applied prefix compensates.
 *
 * Returns `{ cashRaisedAnchor, sharesSold, salesExecuted }` with
 * `salesExecuted` 1 on success or zeros when the holding is missing, the
 * quote is unusable, or a race was lost.
 */
export async function sellFundHoldingShares(
  db: Db,
  fund: IndexFund,
  corporationId: ObjectId,
  maxShares: number,
  options?: {
    session?: ClientSession;
    note?: string;
    settlementCounterparty?: "market" | "issuer";
    keyOptions?: { idempotencyKey?: string };
    /**
     * Pre-quoted leg pinned by a pass driver (issue #1672). Skips every
     * ambient read above so a same-key retry replays the stored figures
     * instead of repricing from post-sale state.
     */
    pinnedLeg?: SellPassLeg;
  }
): Promise<SellHoldingsForRedemptionResult> {
  const zeros: SellHoldingsForRedemptionResult = {
    cashRaisedAnchor: 0,
    sharesSold: 0,
    salesExecuted: 0,
  };
  let leg: SellPassLeg;
  const pinned = options?.pinnedLeg;
  if (pinned) {
    leg = pinned;
  } else {
    const holding = fund.holdings.find(
      (h) => h.corporationId.toString() === corporationId.toString()
    );
    if (!holding || holding.shares <= 0) {
      return zeros;
    }

    const corps = (await db
      .collection<CorpQuoteRow>("corporations")
      .find({ _id: corporationId })
      .project({
        _id: 1,
        name: 1,
        sharePrice: 1,
        fundamentalSharePrice: 1,
        publicFloat: 1,
        totalShares: 1,
        liquidCurrencyCode: 1,
        countryId: 1,
        shareBuybackMode: 1,
        shareEscrowBalance: 1,
      })
      .toArray()) as CorpQuoteRow[];

    const corp = corps[0];
    if (!corp) {
      return zeros;
    }

    const quote = await loadEquityQuote(db, corp);
    const fxRate = fxRateForCorpFromMap(corp, await loadFxRatesByCurrency(db));
    const turn = await getCurrentTurn(db);
    const note = options?.note ?? "Redemption liquidity";
    const quoted = quoteFundHoldingSaleFigures({
      holding,
      corp,
      quote,
      fxRate,
      maxShares,
      note,
      turn,
      settlementCounterparty: options?.settlementCounterparty,
    });
    if (!quoted) {
      return zeros;
    }
    leg = quoted;
  }
  // A deterministic key per fund, corp, turn, and share count: a same-turn
  // retry (crash recovery, same-turn double-fire) reconciles under the
  // stored plan instead of double-selling. The pass overrides this with its
  // own per-leg sub-key.
  const parentKey =
    options?.keyOptions?.idempotencyKey ??
    buildFundShareSellKey(fund._id, corporationId, leg.turn, leg.sharesToSell);

  const sessionOpts = options?.session ? { session: options.session } : {};
  let result: Awaited<ReturnType<typeof applySellLeg>>;
  try {
    result = await applySellLeg(db, fund.name, fund._id, parentKey, leg, sessionOpts);
  } catch (err) {
    if (isSkipSellError(err)) return zeros;
    throw err;
  }
  if (result.outcome.sharesSold <= 0) return zeros;
  return {
    cashRaisedAnchor: result.outcome.cashRaisedAnchor,
    sharesSold: result.outcome.sharesSold,
    salesExecuted: 1,
  };
}
