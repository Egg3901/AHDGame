/**
 * Cross-fund rebalancing market.
 *
 * After public-float absorption, funds that are overweight a constituent can
 * sell shares directly to funds that are underweight the same constituent.
 * Cash moves between funds; no issuer treasury or public float is touched.
 */

import type { ClientSession, Db, ObjectId } from "mongodb";
import type { CurrencyCode } from "@/lib/constants/currencies";
import type { Corporation, IndexFund, IndexFundHolding } from "@/lib/db/types";
import { creditSharesToFund, debitSharesFromFund } from "@/lib/corporations/shareholderOps";
import { resolveShareExecutionPrice } from "@/lib/corporations/marketExecution";
import { convertLocalPriceToAnchor } from "@/lib/indexFunds/fundHoldingsValuation";
import { computeHoldingsValueAnchor } from "@/lib/indexFunds/fundAllocation";
import { INDEX_FUND_MAX_EQUITY_ALLOCATION } from "@/lib/indexFunds/unitAccounting";
import {
  getFundById,
  insertFundTransaction,
  updateFundHoldings,
} from "@/lib/indexFunds/fundQueries";
import { recordShareTrade } from "@/lib/corporations/shareTradeHistory";
import { resolveCorpLiquidCurrencyCode } from "@/lib/currency/corporationCapital";
import { runWithOptionalTransaction } from "@/lib/db/runWithOptionalTransaction";

// ── Types ─────────────────────────────────────────────────────────────────

export type CrossRebalanceCorp = Pick<
  Corporation,
  | "_id"
  | "sharePrice"
  | "fundamentalSharePrice"
  | "totalShares"
  | "publicFloat"
  | "liquidCurrencyCode"
>;

export type CrossRebalanceFund = Pick<
  IndexFund,
  | "_id"
  | "name"
  | "anchorCurrencyCode"
  | "status"
  | "cashAnchor"
  | "holdings"
  | "targetConstituents"
  | "bondAllocations"
>;

export type PlannedCrossTransfer = {
  corporationId: ObjectId;
  sellerFundId: ObjectId;
  buyerFundId: ObjectId;
  shares: number;
  pricePerShareAnchor: number;
  valueAnchor: number;
};

export type CrossRebalanceResult = {
  transfers: number;
  sharesTransferred: number;
  valueTransferred: number;
  errors: string[];
};

type RebalanceParticipant = {
  fundId: ObjectId;
  fundName: string;
  anchorCurrencyCode: CurrencyCode;
  shares: number;
  priceAnchor: number;
  targetWeight: number;
  totalBackingAnchor: number;
  holdingsValueAnchor: number;
  cashAnchor: number;
  maxEquityValueAnchor: number;
  driftShares: number;
};

// ── Planning ──────────────────────────────────────────────────────────────

export function planFundCrossRebalancing(input: {
  funds: CrossRebalanceFund[];
  corps: CrossRebalanceCorp[];
  exchangeRates: Partial<Record<CurrencyCode, number>>;
  bondPrincipalByFundId?: Map<string, number>;
  minTransferShares?: number;
}): PlannedCrossTransfer[] {
  const plans: PlannedCrossTransfer[] = [];
  const bondPrincipalByFundId = input.bondPrincipalByFundId ?? new Map<string, number>();

  // Fund-level resources are shared across every corp in this pass: a buyer
  // fund's cash and its equity-allocation headroom (cap on TOTAL equity) are
  // consumed cumulatively as it buys different corps' shares. Track them per
  // fund — in anchor VALUE so they're comparable across corps priced
  // differently — so the plan can't over-commit cash or breach
  // INDEX_FUND_MAX_EQUITY_ALLOCATION across the whole pass. (Sells are not
  // credited back within a pass — that only keeps us more conservative.)
  const fundCashRemaining = new Map<string, number>();
  const fundEquityRemaining = new Map<string, number>();

  for (const corp of input.corps) {
    const executionPrice = resolveShareExecutionPrice(corp);
    if (!Number.isFinite(executionPrice) || executionPrice <= 0) continue;

    const participants = buildCorpParticipants({
      corp,
      funds: input.funds,
      exchangeRates: input.exchangeRates,
      bondPrincipalByFundId,
    });
    if (participants.length === 0) continue;

    // Seed the fund-level resource trackers the first time we see each fund
    // (its cash and equity headroom are the same fund total regardless of corp).
    for (const p of participants) {
      const key = p.fundId.toString();
      if (!fundCashRemaining.has(key)) fundCashRemaining.set(key, p.cashAnchor);
      if (!fundEquityRemaining.has(key)) {
        fundEquityRemaining.set(key, Math.max(0, p.maxEquityValueAnchor - p.holdingsValueAnchor));
      }
    }

    // Only match funds denominated in the same anchor currency so cash and
    // share value move 1:1 without introducing FX accounting in this pass.
    const byAnchor = groupByAnchor(participants);

    for (const group of byAnchor.values()) {
      const sellers = group
        .filter((p) => p.driftShares > 0)
        .sort((a, b) => b.driftShares - a.driftShares);
      const buyers = group
        .filter((p) => p.driftShares < 0)
        .sort((a, b) => a.driftShares - b.driftShares);
      if (sellers.length === 0 || buyers.length === 0) continue;

      // Deficit is corp-specific drift, so it resets per corp/group.
      const buyerDeficitShares = new Map<string, number>();
      for (const buyer of buyers) {
        buyerDeficitShares.set(buyer.fundId.toString(), -buyer.driftShares);
      }

      for (const seller of sellers) {
        let sellerRemaining = seller.driftShares;

        for (const buyer of buyers) {
          if (sellerRemaining <= 0) break;

          const key = buyer.fundId.toString();
          const deficitShares = buyerDeficitShares.get(key) ?? 0;
          if (deficitShares <= 0) continue;

          const cashRemainingShares = (fundCashRemaining.get(key) ?? 0) / buyer.priceAnchor;
          const equityRemainingShares = (fundEquityRemaining.get(key) ?? 0) / buyer.priceAnchor;

          const transferable = Math.min(
            sellerRemaining,
            deficitShares,
            cashRemainingShares,
            equityRemainingShares
          );
          const shares = Math.max(0, Math.floor(transferable));
          if (shares < (input.minTransferShares ?? 1)) continue;

          const valueAnchor = shares * buyer.priceAnchor;
          plans.push({
            corporationId: corp._id,
            sellerFundId: seller.fundId,
            buyerFundId: buyer.fundId,
            shares,
            pricePerShareAnchor: buyer.priceAnchor,
            valueAnchor,
          });

          sellerRemaining -= shares;
          buyerDeficitShares.set(key, deficitShares - shares);
          fundCashRemaining.set(key, (fundCashRemaining.get(key) ?? 0) - valueAnchor);
          fundEquityRemaining.set(key, (fundEquityRemaining.get(key) ?? 0) - valueAnchor);
        }
      }
    }
  }

  return plans;
}

function buildCorpParticipants(input: {
  corp: CrossRebalanceCorp;
  funds: CrossRebalanceFund[];
  exchangeRates: Partial<Record<CurrencyCode, number>>;
  bondPrincipalByFundId: Map<string, number>;
}): RebalanceParticipant[] {
  const { corp, funds, exchangeRates, bondPrincipalByFundId } = input;
  const executionPrice = resolveShareExecutionPrice(corp);
  if (!Number.isFinite(executionPrice) || executionPrice <= 0) return [];

  const participants: RebalanceParticipant[] = [];

  for (const fund of funds) {
    if (fund.status !== "active") continue;

    const priceAnchor = convertLocalPriceToAnchor(
      executionPrice,
      corp.liquidCurrencyCode,
      fund.anchorCurrencyCode,
      exchangeRates
    );
    if (priceAnchor === null || priceAnchor <= 0) continue;

    const holding = fund.holdings.find((h) => h.corporationId.toString() === corp._id.toString());
    const target = fund.targetConstituents.find(
      (t) => t.corporationId.toString() === corp._id.toString()
    );

    const shares = holding?.shares ?? 0;
    const targetWeight = target?.targetWeight ?? 0;
    const holdingsValueAnchor = computeHoldingsValueAnchor(fund);
    const bondPrincipalAnchor = bondPrincipalByFundId.get(fund._id.toString()) ?? 0;
    const totalBackingAnchor = fund.cashAnchor + holdingsValueAnchor + bondPrincipalAnchor;

    if (totalBackingAnchor <= 0) continue;

    const maxEquityValueAnchor = totalBackingAnchor * INDEX_FUND_MAX_EQUITY_ALLOCATION;
    const targetShares = (totalBackingAnchor * targetWeight) / priceAnchor;
    const driftShares = shares - targetShares;

    // Skip funds that are effectively at target (tiny drift from rounding).
    if (Math.abs(driftShares) < 1e-9) continue;

    participants.push({
      fundId: fund._id,
      fundName: fund.name,
      anchorCurrencyCode: fund.anchorCurrencyCode,
      shares,
      priceAnchor,
      targetWeight,
      totalBackingAnchor,
      holdingsValueAnchor,
      cashAnchor: fund.cashAnchor,
      maxEquityValueAnchor,
      driftShares,
    });
  }

  return participants;
}

function groupByAnchor(
  participants: RebalanceParticipant[]
): Map<CurrencyCode, RebalanceParticipant[]> {
  const map = new Map<CurrencyCode, RebalanceParticipant[]>();
  for (const p of participants) {
    const list = map.get(p.anchorCurrencyCode) ?? [];
    list.push(p);
    map.set(p.anchorCurrencyCode, list);
  }
  return map;
}

// ── Execution ─────────────────────────────────────────────────────────────

export async function executeFundCrossRebalancing(
  db: Db,
  plans: PlannedCrossTransfer[],
  currentTurn: number
): Promise<CrossRebalanceResult> {
  const result: CrossRebalanceResult = {
    transfers: 0,
    sharesTransferred: 0,
    valueTransferred: 0,
    errors: [],
  };

  if (plans.length === 0) return result;

  // Fetch current fund/corp state once and update in memory so consecutive
  // transfers for the same fund see their own cumulative effect.
  const fundState = new Map<string, IndexFund>();
  const corpState = new Map<string, CrossRebalanceCorp>();

  for (const plan of plans) {
    try {
      const executed = await executeSingleTransfer(db, plan, fundState, corpState, currentTurn);
      if (executed) {
        result.transfers++;
        result.sharesTransferred += plan.shares;
        result.valueTransferred += plan.valueAnchor;
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      result.errors.push(
        `Cross-rebalance ${plan.corporationId} ${plan.sellerFundId}→${plan.buyerFundId}: ${message}`
      );
    }
  }

  return result;
}

async function executeSingleTransfer(
  db: Db,
  plan: PlannedCrossTransfer,
  fundState: Map<string, IndexFund>,
  corpState: Map<string, CrossRebalanceCorp>,
  currentTurn: number
): Promise<boolean> {
  const sellerFund = await loadFundState(db, plan.sellerFundId, fundState);
  const buyerFund = await loadFundState(db, plan.buyerFundId, fundState);
  if (!sellerFund || !buyerFund) return false;

  const corpKey = plan.corporationId.toString();
  let corp = corpState.get(corpKey);
  if (!corp) {
    const loaded = await db
      .collection<Corporation>("corporations")
      .findOne({ _id: plan.corporationId });
    if (!loaded) return false;
    corp = loaded;
    corpState.set(corpKey, corp);
  }

  const executionPrice = resolveShareExecutionPrice(corp);
  if (!Number.isFinite(executionPrice) || executionPrice <= 0) return false;

  const sellerHolding = sellerFund.holdings.find((h) => h.corporationId.toString() === corpKey);
  if (!sellerHolding || sellerHolding.shares < plan.shares) return false;

  if (buyerFund.cashAnchor < plan.valueAnchor) return false;

  const applyTransfer = async (session?: ClientSession): Promise<boolean> => {
    const sessionOpts = session ? { session } : undefined;

    // 1. Debit shares from seller on corporation cap table.
    const sellerRemaining = await debitSharesFromFund(
      db,
      plan.corporationId,
      plan.sellerFundId,
      plan.shares,
      { $set: { updatedAt: new Date() } },
      { requireSufficient: true, ...sessionOpts }
    );
    if (sellerRemaining < 0) return false;

    // 2. Credit shares to buyer on corporation cap table.
    const buyerCredited = await creditSharesToFund(
      db,
      plan.corporationId,
      plan.buyerFundId,
      plan.shares,
      executionPrice,
      { $set: { updatedAt: new Date() } },
      sessionOpts
    );
    if (!buyerCredited) {
      // Best-effort rollback of seller debit.
      await creditSharesToFund(
        db,
        plan.corporationId,
        plan.sellerFundId,
        plan.shares,
        executionPrice,
        { $set: { updatedAt: new Date() } },
        sessionOpts
      );
      return false;
    }

    // 3. Move cash: buyer → seller.
    const cashMoved = await atomicallyMoveFundCash(
      db,
      plan.buyerFundId,
      plan.sellerFundId,
      plan.valueAnchor,
      sessionOpts
    );
    if (!cashMoved) {
      // Rollback share movements.
      await creditSharesToFund(
        db,
        plan.corporationId,
        plan.sellerFundId,
        plan.shares,
        executionPrice,
        { $set: { updatedAt: new Date() } },
        sessionOpts
      );
      await debitSharesFromFund(
        db,
        plan.corporationId,
        plan.buyerFundId,
        plan.shares,
        { $set: { updatedAt: new Date() } },
        { requireSufficient: true, ...sessionOpts }
      );
      return false;
    }

    // 4. Update in-memory fund holdings.
    const updatedSellerHoldings = updateHoldingAfterSale(
      sellerFund.holdings,
      plan.corporationId,
      plan.shares,
      plan.pricePerShareAnchor
    );
    const updatedBuyerHoldings = updateHoldingAfterPurchase(
      buyerFund.holdings,
      plan.corporationId,
      plan.shares,
      plan.pricePerShareAnchor
    );

    // 5. Persist holdings arrays.
    await updateFundHoldings(db, plan.sellerFundId, updatedSellerHoldings, sessionOpts);
    await updateFundHoldings(db, plan.buyerFundId, updatedBuyerHoldings, sessionOpts);

    // 6. Log transactions.
    await insertFundTransaction(
      db,
      {
        fundId: plan.sellerFundId,
        kind: "cross_fund_sell",
        corporationId: plan.corporationId,
        shares: plan.shares,
        navAnchor: plan.pricePerShareAnchor,
        amountAnchor: plan.valueAnchor,
        note: `Sold ${plan.shares} shares to ${buyerFund.name}`,
        createdAt: new Date(),
      },
      sessionOpts
    );
    await insertFundTransaction(
      db,
      {
        fundId: plan.buyerFundId,
        kind: "cross_fund_buy",
        corporationId: plan.corporationId,
        shares: plan.shares,
        navAnchor: plan.pricePerShareAnchor,
        amountAnchor: plan.valueAnchor,
        note: `Bought ${plan.shares} shares from ${sellerFund.name}`,
        createdAt: new Date(),
      },
      sessionOpts
    );

    // 7. Record public trade history (the cross-fund market is still a trade).
    void recordShareTrade(db, {
      corporationId: plan.corporationId,
      kind: "market_buy",
      turn: currentTurn,
      shares: plan.shares,
      pricePerShareAnchor: plan.pricePerShareAnchor,
      from: { name: `${sellerFund.name} (index fund)` },
      to: { name: `${buyerFund.name} (index fund)` },
      corpCurrencyCode: resolveCorpLiquidCurrencyCode(corp) ?? undefined,
      note: "Cross-fund rebalancing transfer",
    });

    // 8. Refresh in-memory state for subsequent transfers in this batch.
    sellerFund.holdings = updatedSellerHoldings;
    sellerFund.cashAnchor += plan.valueAnchor;
    buyerFund.holdings = updatedBuyerHoldings;
    buyerFund.cashAnchor -= plan.valueAnchor;

    return true;
  };

  return runWithOptionalTransaction(
    (session) => applyTransfer(session),
    () => applyTransfer()
  );
}

async function loadFundState(
  db: Db,
  fundId: ObjectId,
  fundState: Map<string, IndexFund>
): Promise<IndexFund | null> {
  const key = fundId.toString();
  let fund: IndexFund | null = fundState.get(key) ?? null;
  if (!fund) {
    fund = await getFundById(db, fundId);
    if (fund) fundState.set(key, fund);
  }
  return fund;
}

async function atomicallyMoveFundCash(
  db: Db,
  buyerFundId: ObjectId,
  sellerFundId: ObjectId,
  amountAnchor: number,
  options?: { session?: ClientSession }
): Promise<boolean> {
  if (!Number.isFinite(amountAnchor) || amountAnchor <= 0) return false;

  const now = new Date();
  const sessionOpts = options?.session ? { session: options.session } : undefined;

  const buyerDebit = await db
    .collection<IndexFund>("indexFunds")
    .updateOne(
      { _id: buyerFundId, cashAnchor: { $gte: amountAnchor } },
      { $inc: { cashAnchor: -amountAnchor }, $set: { updatedAt: now } },
      sessionOpts
    );
  if (buyerDebit.matchedCount === 0) return false;

  await db
    .collection<IndexFund>("indexFunds")
    .updateOne(
      { _id: sellerFundId },
      { $inc: { cashAnchor: amountAnchor }, $set: { updatedAt: now } },
      sessionOpts
    );

  return true;
}

// ── Holding updates ───────────────────────────────────────────────────────

export function updateHoldingAfterPurchase(
  holdings: IndexFundHolding[],
  corporationId: ObjectId,
  additionalShares: number,
  sharePriceAnchor: number
): IndexFundHolding[] {
  const existing = holdings.find((h) => h.corporationId.toString() === corporationId.toString());
  if (existing) {
    return holdings.map((h) => {
      if (h.corporationId.toString() !== corporationId.toString()) return h;
      const newShares = h.shares + additionalShares;
      const newAvg =
        h.avgCostPerShareAnchor !== undefined
          ? (h.shares * h.avgCostPerShareAnchor + additionalShares * sharePriceAnchor) / newShares
          : sharePriceAnchor;
      return {
        ...h,
        shares: newShares,
        avgCostPerShareAnchor: newAvg,
        lastValueAnchor: newShares * sharePriceAnchor,
      };
    });
  }
  return [
    ...holdings,
    {
      corporationId,
      shares: additionalShares,
      avgCostPerShareAnchor: sharePriceAnchor,
      lastValueAnchor: additionalShares * sharePriceAnchor,
    },
  ];
}

export function updateHoldingAfterSale(
  holdings: IndexFundHolding[],
  corporationId: ObjectId,
  sharesSold: number,
  sharePriceAnchor: number
): IndexFundHolding[] {
  return holdings
    .map((h) => {
      if (h.corporationId.toString() !== corporationId.toString()) return h;
      const newShares = h.shares - sharesSold;
      if (newShares <= 0) return null;
      return {
        ...h,
        shares: newShares,
        lastValueAnchor: newShares * sharePriceAnchor,
      };
    })
    .filter((h): h is IndexFundHolding => h !== null);
}
