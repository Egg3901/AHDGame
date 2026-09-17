/**
 * Cross-fund rebalancing market.
 *
 * After public-float absorption, funds that are overweight a constituent can
 * sell shares directly to funds that are underweight the same constituent.
 * Cash moves between funds; no issuer treasury or public float is touched.
 */

import type { ClientSession, Db, ObjectId, UpdateFilter } from "mongodb";
import type { CurrencyCode } from "@/lib/constants/currencies";
import type { Corporation, IndexFund, IndexFundHolding, Shareholder } from "@/lib/db/types";
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
import { emitTx } from "@/lib/financialTxLog/emit";

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
  const corpState = new Map<string, Corporation>();

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
  corpState: Map<string, Corporation>,
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

  const sellerShareholder = cloneFundShareholder(corp.shareholders, plan.sellerFundId);
  const buyerShareholder = cloneFundShareholder(corp.shareholders, plan.buyerFundId);

  const applyTransfer = async (session?: ClientSession): Promise<boolean> => {
    const sessionOpts = session ? { session } : undefined;
    const compensateOnFailure = !session;
    const completed = {
      sellerSharesDebited: false,
      buyerSharesCredited: false,
      buyerCashDebited: false,
      sellerCashCredited: false,
      sellerHoldingsUpdated: false,
      buyerHoldingsUpdated: false,
      sellerTransactionId: undefined as ObjectId | undefined,
      buyerTransactionId: undefined as ObjectId | undefined,
    };

    const compensate = async (originalError: unknown): Promise<never> => {
      const failures: Error[] = [];
      const attempt = async (label: string, action: () => Promise<boolean | void>) => {
        try {
          const succeeded = await action();
          if (succeeded === false) failures.push(new Error(`${label} returned no match`));
        } catch (error) {
          failures.push(
            new Error(`${label}: ${error instanceof Error ? error.message : String(error)}`)
          );
        }
      };

      if (completed.buyerTransactionId) {
        await attempt("delete buyer transaction", async () => {
          const deleted = await db
            .collection("indexFundTransactions")
            .deleteOne({ _id: completed.buyerTransactionId });
          return deleted.deletedCount === 1;
        });
      }
      if (completed.sellerTransactionId) {
        await attempt("delete seller transaction", async () => {
          const deleted = await db
            .collection("indexFundTransactions")
            .deleteOne({ _id: completed.sellerTransactionId });
          return deleted.deletedCount === 1;
        });
      }
      if (completed.buyerHoldingsUpdated) {
        await attempt("restore buyer holdings", () =>
          updateFundHoldings(db, plan.buyerFundId, buyerFund.holdings)
        );
      }
      if (completed.sellerHoldingsUpdated) {
        await attempt("restore seller holdings", () =>
          updateFundHoldings(db, plan.sellerFundId, sellerFund.holdings)
        );
      }
      if (completed.sellerCashCredited) {
        await attempt("debit seller compensation cash", async () => {
          const result = await db
            .collection<IndexFund>("indexFunds")
            .updateOne(
              { _id: plan.sellerFundId, cashAnchor: { $gte: plan.valueAnchor } },
              { $inc: { cashAnchor: -plan.valueAnchor }, $set: { updatedAt: new Date() } }
            );
          return result.matchedCount === 1;
        });
      }
      if (completed.buyerCashDebited) {
        await attempt("credit buyer compensation cash", async () => {
          const result = await db
            .collection<IndexFund>("indexFunds")
            .updateOne(
              { _id: plan.buyerFundId },
              { $inc: { cashAnchor: plan.valueAnchor }, $set: { updatedAt: new Date() } }
            );
          return result.matchedCount === 1;
        });
      }
      if (completed.buyerSharesCredited) {
        await attempt("restore buyer shareholder", () =>
          restoreFundShareholder(
            db,
            plan.corporationId,
            plan.buyerFundId,
            buyerShareholder,
            (buyerShareholder?.shares ?? 0) + plan.shares,
            computePostCreditAverage(buyerShareholder, plan.shares, executionPrice)
          )
        );
      }
      if (completed.sellerSharesDebited) {
        await attempt("restore seller shareholder", () =>
          restoreFundShareholder(
            db,
            plan.corporationId,
            plan.sellerFundId,
            sellerShareholder,
            sellerShareholder ? sellerShareholder.shares - plan.shares : 0,
            sellerShareholder?.avgCostPerShare
          )
        );
      }

      if (failures.length > 0) {
        const original =
          originalError instanceof Error ? originalError : new Error(String(originalError));
        throw new AggregateError(
          [original, ...failures],
          `${original.message}; compensation failed: ${failures.map((error) => error.message).join("; ")}`
        );
      }
      throw originalError;
    };

    try {
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
      completed.sellerSharesDebited = true;

      // 2. Credit shares to buyer on corporation cap table.
      const buyerCredited = await creditSharesToFund(
        db,
        plan.corporationId,
        plan.buyerFundId,
        plan.shares,
        executionPrice,
        { $set: { updatedAt: new Date() } },
        { ...sessionOpts, knownShareholders: corp.shareholders }
      );
      if (!buyerCredited) {
        if (compensateOnFailure) throw new Error("Failed to credit buyer shares");
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
      completed.buyerSharesCredited = true;

      // 3. Move cash: buyer → seller.
      const cashMoved = await atomicallyMoveFundCash(
        db,
        plan.buyerFundId,
        plan.sellerFundId,
        plan.valueAnchor,
        sessionOpts,
        completed
      );
      if (!cashMoved) {
        if (compensateOnFailure) throw new Error("Failed to move fund cash");
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
      completed.sellerHoldingsUpdated = true;
      await updateFundHoldings(db, plan.buyerFundId, updatedBuyerHoldings, sessionOpts);
      completed.buyerHoldingsUpdated = true;

      // 6. Log transactions.
      completed.sellerTransactionId = await insertFundTransaction(
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
      completed.buyerTransactionId = await insertFundTransaction(
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

      // Emit one cash-transfer row after both fund balances and holdings have
      // moved. The ledger derives the seller mirror from metadata, so a second
      // row would double-count the transfer.
      await emitTx(db, {
        type: "fund_transfer",
        turn: currentTurn,
        createdAt: new Date(),
        subjectType: "fund",
        subjectId: plan.buyerFundId,
        subjectName: buyerFund.name,
        amount: -plan.valueAnchor,
        anchorAmount: -plan.valueAnchor,
        currencyCode: buyerFund.anchorCurrencyCode,
        counterpartyType: "fund",
        counterpartyId: plan.sellerFundId,
        counterpartyName: sellerFund.name,
        meta: {
          fundId: plan.sellerFundId.toString(),
          fundCurrency: buyerFund.anchorCurrencyCode,
          corporationId: plan.corporationId.toString(),
          shares: plan.shares,
          pricePerShareAnchor: plan.pricePerShareAnchor,
          source: "cross-fund-rebalancing",
        },
      });

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
      corp.shareholders = applyFundShareholderTransfer(
        corp.shareholders,
        sellerShareholder,
        buyerShareholder,
        plan,
        executionPrice
      );

      return true;
    } catch (error) {
      if (compensateOnFailure) await compensate(error);
      throw error;
    }
  };

  return runWithOptionalTransaction(
    (session) => applyTransfer(session),
    () => applyTransfer()
  );
}

function cloneFundShareholder(
  shareholders: Corporation["shareholders"],
  fundId: ObjectId
): Shareholder | undefined {
  const shareholder = shareholders?.find((entry) => entry.fundId?.equals(fundId));
  return shareholder ? { ...shareholder } : undefined;
}

async function restoreFundShareholder(
  db: Db,
  corporationId: ObjectId,
  fundId: ObjectId,
  snapshot: Shareholder | undefined,
  expectedCurrentShares: number,
  expectedCurrentAverage: number | undefined
): Promise<boolean> {
  const collection = db.collection<Corporation>("corporations");
  const expectedEntry = {
    fundId,
    shares: expectedCurrentShares,
    ...(expectedCurrentAverage === undefined
      ? { avgCostPerShare: { $exists: false } }
      : { avgCostPerShare: expectedCurrentAverage }),
  };
  if (!snapshot) {
    const result = await collection.updateOne(
      {
        _id: corporationId,
        shareholders: { $elemMatch: expectedEntry },
      },
      {
        $pull: {
          shareholders: expectedEntry,
        } as unknown as UpdateFilter<Corporation>["$pull"],
        $set: { updatedAt: new Date() },
      }
    );
    return result.matchedCount === 1;
  }

  if (expectedCurrentShares === 0) {
    const result = await collection.updateOne(
      {
        _id: corporationId,
        shareholders: { $not: { $elemMatch: { fundId } } },
      },
      {
        $push: { shareholders: snapshot } as unknown as UpdateFilter<Corporation>["$push"],
        $set: { updatedAt: new Date() },
      }
    );
    return result.matchedCount === 1;
  }

  const result = await collection.updateOne(
    {
      _id: corporationId,
      shareholders: { $elemMatch: expectedEntry },
    },
    {
      $set: {
        "shareholders.$.shares": snapshot.shares,
        ...(snapshot.avgCostPerShare === undefined
          ? {}
          : { "shareholders.$.avgCostPerShare": snapshot.avgCostPerShare }),
        updatedAt: new Date(),
      },
      ...(snapshot.avgCostPerShare === undefined
        ? { $unset: { "shareholders.$.avgCostPerShare": "" as const } }
        : {}),
    }
  );
  return result.matchedCount === 1;
}

function computePostCreditAverage(
  shareholder: Shareholder | undefined,
  shares: number,
  executionPrice: number
): number {
  if (!shareholder) return executionPrice;
  return (
    ((shareholder.avgCostPerShare ?? executionPrice) * shareholder.shares +
      executionPrice * shares) /
    (shareholder.shares + shares)
  );
}

function applyFundShareholderTransfer(
  shareholders: Corporation["shareholders"],
  seller: Shareholder | undefined,
  buyer: Shareholder | undefined,
  plan: PlannedCrossTransfer,
  executionPrice: number
): Corporation["shareholders"] {
  const withoutParticipants = (shareholders ?? []).filter(
    (entry) => !entry.fundId?.equals(plan.sellerFundId) && !entry.fundId?.equals(plan.buyerFundId)
  );
  const sellerShares = (seller?.shares ?? 0) - plan.shares;
  if (seller && sellerShares > 0) withoutParticipants.push({ ...seller, shares: sellerShares });
  const buyerShares = (buyer?.shares ?? 0) + plan.shares;
  const buyerAverage = computePostCreditAverage(buyer, plan.shares, executionPrice);
  withoutParticipants.push({
    ...buyer,
    fundId: plan.buyerFundId,
    shares: buyerShares,
    avgCostPerShare: buyerAverage,
  });
  return withoutParticipants;
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
  options?: { session?: ClientSession },
  progress?: { buyerCashDebited: boolean; sellerCashCredited: boolean }
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
  if (progress) progress.buyerCashDebited = true;

  const sellerCredit = await db
    .collection<IndexFund>("indexFunds")
    .updateOne(
      { _id: sellerFundId },
      { $inc: { cashAnchor: amountAnchor }, $set: { updatedAt: now } },
      sessionOpts
    );
  if (sellerCredit.matchedCount === 0) return false;
  if (progress) progress.sellerCashCredited = true;

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
