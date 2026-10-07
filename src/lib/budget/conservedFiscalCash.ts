/**
 * Shell for conserved sovereign financing (#3381). Loads the turn's receipts
 * and balances, asks `rules/conservedFiscalCash` what moves, and settles each
 * flow through the settlement journal under a turn-scoped key. A retried phase
 * resumes the recorded settlement instead of re-planning it.
 */
import type { Db } from "mongodb";
import { getBankId } from "@/lib/centralBank/helpers";
import { getCountryIdForCurrency, type CurrencyCode } from "@/lib/constants/currencies";
import type { FederalBudget, TreasuryAccrualReceipt } from "@/lib/db/types/budget";
import type { GameConfig } from "@/lib/db/types/gameConfig";
import { MONEY_MOVE_COLLECTION } from "@/lib/banking/moneyMove";
import {
  resumeSettlement,
  settleTransition,
  type SettlementResult,
} from "@/lib/banking/settlementJournal";
import type { BankingTransition } from "@/lib/banking/rules/boundary";
import {
  PLAYER_TAX_RECEIPT_KINDS,
  conservedFiscalKey,
  conservedPoolFlowTransition,
  householdTaxTransition,
  planHouseholdTax,
  planPrimarySpending,
  playerTaxReceiptsByCountry,
  primarySpendingTransition,
  unfundedFallbackKey,
  unfundedPlan,
  type ConservedFiscalTarget,
  type ConservedFlowPlan,
  type PlayerTaxReceiptRecord,
} from "@/lib/budget/rules/conservedFiscalCash";

/** Both gates: funded Treasury cash, and the fresh-world conserved financing opt-in. */
export function conservedFinancingActive(
  config: Pick<
    GameConfig,
    "treasuryCashLedgerEnabled" | "conservedSovereignFinancingEnabled"
  > | null
): boolean {
  return (
    config?.treasuryCashLedgerEnabled === true &&
    config?.conservedSovereignFinancingEnabled === true
  );
}

/** The central bank document holding a currency's household money stock. */
export function householdMoneyBankId(currency: string): string {
  return getBankId(getCountryIdForCurrency(currency as CurrencyCode));
}

export interface ConservedFiscalContext {
  turn: number;
  playerTaxByCountry: Map<string, number>;
  /** Running snapshot of `externalBroadMoney`; guards on the write stay authoritative. */
  householdCashByBank: Map<string, number>;
}

/** Two reads per turn, whatever the number of countries. */
export async function loadConservedFiscalContext(
  db: Db,
  turn: number
): Promise<ConservedFiscalContext> {
  const [receipts, banks] = await Promise.all([
    db
      .collection<PlayerTaxReceiptRecord & { _id: string }>(MONEY_MOVE_COLLECTION)
      .find(
        { turn, kind: { $in: [...PLAYER_TAX_RECEIPT_KINDS] } },
        { projection: { kind: 1, turn: 1, legs: 1 } }
      )
      .toArray(),
    db
      .collection<{ _id: string; externalBroadMoney?: number }>("centralBanks")
      .find({}, { projection: { externalBroadMoney: 1 } })
      .toArray(),
  ]);
  return {
    turn,
    playerTaxByCountry: playerTaxReceiptsByCountry(receipts, turn),
    householdCashByBank: new Map(
      banks.map((bank) => [
        String(bank._id),
        typeof bank.externalBroadMoney === "number" && Number.isFinite(bank.externalBroadMoney)
          ? bank.externalBroadMoney
          : 0,
      ])
    ),
  };
}

/**
 * A resumed settlement may land legs the context snapshot predates. Countries
 * sharing a currency share one household stock, so re-read it rather than let
 * the next country plan against a stale balance. Costs one read per resumed
 * flow, none on the normal path.
 */
async function refreshHouseholdCash(
  db: Db,
  ctx: ConservedFiscalContext,
  centralBankId: string
): Promise<void> {
  const bank = await db
    .collection<{ _id: string; externalBroadMoney?: number }>("centralBanks")
    .findOne({ _id: centralBankId }, { projection: { externalBroadMoney: 1 } });
  const cash = bank?.externalBroadMoney;
  ctx.householdCashByBank.set(
    centralBankId,
    typeof cash === "number" && Number.isFinite(cash) ? cash : 0
  );
}

type ConservedBudget = Pick<FederalBudget, "_id" | "countryId" | "conservedFiscalCash">;

function targetFor(
  turn: number,
  budget: ConservedBudget,
  receipt: TreasuryAccrualReceipt
): ConservedFiscalTarget {
  return {
    turn,
    countryId: String(budget.countryId ?? budget._id),
    budgetId: String(budget._id),
    currency: receipt.currencyCode,
    centralBankId: householdMoneyBankId(receipt.currencyCode),
  };
}

function settledOrThrow(result: SettlementResult, key: string): SettlementResult {
  if (result.status === "applied" || result.status === "replayed") return result;
  throw new Error(result.error ?? `Conserved fiscal settlement ${key} is incomplete`);
}

/**
 * Settle one planned flow exactly once. A recorded primary settlement is
 * resumed. A primary whose payer guard refused (a stale balance snapshot) is
 * replaced by its unfunded fallback, which moves nothing and books the whole
 * amount as arrears. A partial settlement throws so the phase retry resumes it.
 */
async function settleFlow(
  db: Db,
  key: string,
  build: () => { transition: BankingTransition; plan: ConservedFlowPlan },
  fallback: (plan: ConservedFlowPlan) => BankingTransition
): Promise<{ paid: number; resumed: boolean }> {
  const fallbackKey = unfundedFallbackKey(key);
  const recorded = await db
    .collection<{ _id: string; status?: string }>(MONEY_MOVE_COLLECTION)
    .find({ _id: { $in: [key, fallbackKey] } }, { projection: { _id: 1, status: 1 } })
    .toArray();
  const primary = recorded.find((row) => row._id === key);
  const unfunded = recorded.find((row) => row._id === fallbackKey);
  if (unfunded) {
    settledOrThrow(await resumeSettlement(db, fallbackKey), fallbackKey);
    return { paid: 0, resumed: true };
  }
  if (primary && primary.status !== "rejected") {
    settledOrThrow(await resumeSettlement(db, key), key);
    return { paid: 0, resumed: true };
  }
  const { transition, plan } = build();
  if (!primary) {
    const result = await settleTransition(db, transition);
    if (result.status !== "rejected") {
      settledOrThrow(result, key);
      return { paid: plan.paid, resumed: false };
    }
  }
  const unfundedTransition = fallback(unfundedPlan(plan));
  settledOrThrow(await settleTransition(db, unfundedTransition), fallbackKey);
  return { paid: 0, resumed: false };
}

/** Non-player tax cash into the Treasury. Runs after the signed accrual receipt lands. */
export async function settleConservedHouseholdTax(
  db: Db,
  ctx: ConservedFiscalContext,
  budget: ConservedBudget,
  receipt: TreasuryAccrualReceipt
): Promise<{ paid: number }> {
  const target = targetFor(ctx.turn, budget, receipt);
  const key = conservedFiscalKey("tax", target);
  let planned: ReturnType<typeof planHouseholdTax> | undefined;
  const outcome = await settleFlow(
    db,
    key,
    () => {
      planned = planHouseholdTax({
        revenueSlice: receipt.components.revenue,
        playerTaxReceipts: ctx.playerTaxByCountry.get(target.countryId) ?? 0,
        priorArrears: budget.conservedFiscalCash?.householdTaxArrearsLocal ?? 0,
        householdCash: ctx.householdCashByBank.get(target.centralBankId) ?? 0,
      });
      return { transition: householdTaxTransition(target, planned), plan: planned };
    },
    (plan) =>
      householdTaxTransition(
        target,
        { ...plan, playerTaxReceipts: planned?.playerTaxReceipts ?? 0 },
        unfundedFallbackKey(key)
      )
  );
  if (outcome.resumed) await refreshHouseholdCash(db, ctx, target.centralBankId);
  else if (outcome.paid > 0) {
    ctx.householdCashByBank.set(
      target.centralBankId,
      (ctx.householdCashByBank.get(target.centralBankId) ?? 0) - outcome.paid
    );
  }
  return { paid: outcome.paid };
}

/** Primary spending cash back to the household stock. Runs after coupon settlement. */
export async function settleConservedPrimarySpending(
  db: Db,
  ctx: ConservedFiscalContext,
  budget: ConservedBudget,
  receipt: TreasuryAccrualReceipt
): Promise<{ paid: number }> {
  const target = targetFor(ctx.turn, budget, receipt);
  const key = conservedFiscalKey("spending", target);
  // Coupons may have spent the cash since the budget was read; plan from now.
  const fresh = await db
    .collection<FederalBudget>("federalBudget")
    .findOne({ _id: budget._id }, { projection: { treasuryCashLocal: 1, conservedFiscalCash: 1 } });
  const outcome = await settleFlow(
    db,
    key,
    () => {
      const plan = planPrimarySpending({
        spendingSlice: -receipt.components.primarySpending,
        priorArrears: fresh?.conservedFiscalCash?.primarySpendingArrearsLocal ?? 0,
        treasuryCash: fresh?.treasuryCashLocal ?? 0,
      });
      return { transition: primarySpendingTransition(target, plan), plan };
    },
    (plan) => primarySpendingTransition(target, plan, unfundedFallbackKey(key))
  );
  if (outcome.resumed) await refreshHouseholdCash(db, ctx, target.centralBankId);
  else if (outcome.paid > 0) {
    ctx.householdCashByBank.set(
      target.centralBankId,
      (ctx.householdCashByBank.get(target.centralBankId) ?? 0) + outcome.paid
    );
  }
  return { paid: outcome.paid };
}

/**
 * Conserved bond-pool inflow or sweep. Replaces the minted `inflowIn` and the
 * burned `sweepOut` when conserved financing is active. A refused guard moves
 * nothing: the pool stays short this turn rather than minting the difference.
 */
export async function settleConservedPoolFlow(
  db: Db,
  input: { turn: number; currency: string; direction: "inflow" | "sweep"; amount: number }
): Promise<{ moved: number }> {
  const transition = conservedPoolFlowTransition({
    ...input,
    centralBankId: householdMoneyBankId(input.currency),
  });
  if (transition.legs[0].amount <= 0) return { moved: 0 };
  const existing = await db
    .collection<{ _id: string; status?: string }>(MONEY_MOVE_COLLECTION)
    .findOne({ _id: transition.key }, { projection: { status: 1 } });
  if (existing) {
    if (existing.status === "rejected") return { moved: 0 };
    settledOrThrow(await resumeSettlement(db, transition.key), transition.key);
    return { moved: 0 };
  }
  const result = await settleTransition(db, transition);
  if (result.status === "rejected") return { moved: 0 };
  settledOrThrow(result, transition.key);
  return { moved: transition.legs[0].amount };
}
