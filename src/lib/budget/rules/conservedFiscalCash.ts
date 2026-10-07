/**
 * Conserved sovereign financing (#3381): the cash side of the macro fiscal slice.
 *
 * The signed fiscal accrual (`treasuryAccrual.ts`) moves a 1/TURNS_PER_YEAR
 * slice of national revenue and primary spending into `treasuryBalance`, a
 * signed analytics position. Spendable Treasury cash (`treasuryCashLocal`) is
 * a funded balance that only real settlements move, so national-scale coupon
 * claims froze against a player-scale cash stock.
 *
 * This module closes that loop without creating money. The unmodeled
 * household and business economy already owns a funded money stock per
 * currency: the central bank's `externalBroadMoney`, seeded once at world
 * creation from the era broad-money ratio, counted inside M2, and already the
 * named counterparty for bank deposit capture, savings payouts and crisis
 * stimulus. Each turn:
 *
 * 1. The non-player share of the revenue slice moves from that stock into
 *    Treasury cash. Corporate tax and SOE profit remittances already paid in
 *    cash this turn are subtracted first, so they are never collected twice.
 * 2. Coupon claims settle from Treasury cash through the existing funded
 *    holder and bond-pool machinery (unchanged, not in this module).
 * 3. The primary spending slice returns from Treasury cash to the same stock.
 *
 * Neither leg can overdraw: a payer that cannot cover its share leaves an
 * explicit arrears balance carried to the next turn, never a silent success
 * and never a mint. Plain data in, plain data out.
 */

import type { BankingTransition } from "@/lib/banking/rules/boundary";

/** Journal kinds whose actual Treasury credits overlap the macro revenue slice. */
export const BUDGET_REVENUE_RECEIPT_KINDS = [
  "corporate_tax_withholding",
  "corporate_tax_arrears_payment",
  "soe_profit_remittance",
] as const;

export const CONSERVED_FISCAL_TAX_KIND = "conserved_fiscal_household_tax";
export const CONSERVED_FISCAL_SPENDING_KIND = "conserved_fiscal_primary_spending";
export const CONSERVED_POOL_INFLOW_KIND = "conserved_bond_pool_household_inflow";
export const CONSERVED_POOL_SWEEP_KIND = "conserved_bond_pool_household_sweep";

/** Cents. Every planned amount is rounded the same way so retries quote the same legs. */
export function roundCash(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * 100) / 100;
}

function nonNegative(value: number | undefined): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;
}

/** A journal record as the receipt reader needs it. */
export interface BudgetRevenueReceiptRecord {
  kind: string;
  turn?: number;
  legs?: Array<{
    kind: string;
    amount: number;
    applied?: boolean;
    collection?: string;
    path?: string;
    filter?: Record<string, unknown>;
  }>;
}

/**
 * Sum the Treasury cash each country actually received from modeled revenue this
 * turn, keyed by country id. Only landed credit legs count; a rejected or
 * half-landed withholding contributes exactly what reached the Treasury.
 */
export function fundedRevenueReceiptsByCountry(
  records: readonly BudgetRevenueReceiptRecord[],
  turn: number
): Map<string, number> {
  const kinds = new Set<string>(BUDGET_REVENUE_RECEIPT_KINDS);
  const out = new Map<string, number>();
  for (const record of records) {
    if (!kinds.has(record.kind) || record.turn !== turn) continue;
    for (const leg of record.legs ?? []) {
      if (
        leg.kind !== "credit" ||
        leg.applied !== true ||
        leg.collection !== "federalBudget" ||
        leg.path !== "treasuryCashLocal"
      )
        continue;
      const countryId = leg.filter?.countryId;
      if (typeof countryId !== "string") continue;
      out.set(countryId, (out.get(countryId) ?? 0) + nonNegative(leg.amount));
    }
  }
  return out;
}

/** One funded flow for one turn: what was owed, what moved, what is still owed. */
export interface ConservedFlowPlan {
  /** Obligation arising this turn, after modeled cash receipts are netted out. */
  currentDue: number;
  /** Arrears carried in from earlier turns. */
  priorArrears: number;
  /** Cash that moves now. Never more than the payer's funded balance. */
  paid: number;
  /** Arrears carried to the next turn. currentDue + priorArrears - paid. */
  arrearsAfter: number;
}

function planFlow(currentDue: number, priorArrears: number, payerCash: number): ConservedFlowPlan {
  const due = roundCash(nonNegative(currentDue));
  const prior = roundCash(nonNegative(priorArrears));
  const paid = roundCash(Math.min(due + prior, nonNegative(payerCash)));
  return {
    currentDue: due,
    priorArrears: prior,
    paid,
    arrearsAfter: roundCash(due + prior - paid),
  };
}

/**
 * Household tax cash for one country and turn. `revenueSlice` is the frozen
 * accrual receipt's revenue component, so the cash leg is the same slice the
 * signed position already booked. Overlapping revenue already received in cash is
 * removed from it; a receipt larger than the slice is never clawed back.
 */
export function planHouseholdTax(input: {
  revenueSlice: number;
  fundedRevenueReceipts: number;
  priorArrears: number;
  householdCash: number;
}): ConservedFlowPlan & { fundedRevenueReceipts: number } {
  const receipts = roundCash(nonNegative(input.fundedRevenueReceipts));
  const plan = planFlow(
    nonNegative(input.revenueSlice) - receipts,
    input.priorArrears,
    input.householdCash
  );
  return { ...plan, fundedRevenueReceipts: receipts };
}

/**
 * Primary spending cash for one country and turn, paid after debt service.
 * Treasury cash the coupon pass left is the only source; the rest is a
 * spending arrear the Treasury owes the non-player economy.
 */
export function planPrimarySpending(input: {
  spendingSlice: number;
  priorArrears: number;
  treasuryCash: number;
}): ConservedFlowPlan {
  return planFlow(input.spendingSlice, input.priorArrears, input.treasuryCash);
}

export interface ConservedFiscalTarget {
  turn: number;
  countryId: string;
  budgetId: string;
  currency: string;
  /** Central bank document owning the currency's `externalBroadMoney`. */
  centralBankId: string;
}

export function conservedFiscalKey(
  flow: "tax" | "spending",
  target: Pick<ConservedFiscalTarget, "turn" | "countryId">
): string {
  return `conserved-fiscal:${target.turn}:${target.countryId}:${flow}`;
}

/** The fallback key used when a planned transfer's guard refused at settlement time. */
export function unfundedFallbackKey(key: string): string {
  return `${key}:unfunded`;
}

/** Re-plan after the payer's guard refused: nothing moves, everything is still owed. */
export function unfundedPlan(plan: ConservedFlowPlan): ConservedFlowPlan {
  return { ...plan, paid: 0, arrearsAfter: roundCash(plan.currentDue + plan.priorArrears) };
}

function arrearsProjection(
  target: ConservedFiscalTarget,
  field: "householdTaxArrearsLocal" | "primarySpendingArrearsLocal",
  lifetimeField: "taxCashIn" | "spendingCashOut",
  plan: ConservedFlowPlan
): BankingTransition["projections"][number] {
  return {
    collection: "federalBudget",
    filter: { _id: target.budgetId },
    update: {
      $inc: {
        [`conservedFiscalCash.${field}`]: roundCash(plan.arrearsAfter - plan.priorArrears),
        [`conservedFiscalCash.lifetime.${lifetimeField}`]: plan.paid,
      },
      $set: { [`conservedFiscalCash.last.${lifetimeField}Turn`]: target.turn },
    },
    note: "Carry the conserved fiscal arrears and lifetime cash flow",
  };
}

function planMeta(plan: ConservedFlowPlan, extra: Record<string, number> = {}) {
  return {
    currentDue: plan.currentDue,
    priorArrears: plan.priorArrears,
    paid: plan.paid,
    arrearsAfter: plan.arrearsAfter,
    ...extra,
  };
}

/** Household money stock pays the non-player tax slice into spendable Treasury cash. */
export function householdTaxTransition(
  target: ConservedFiscalTarget,
  plan: ConservedFlowPlan & { fundedRevenueReceipts?: number },
  key = conservedFiscalKey("tax", target)
): BankingTransition {
  const legs: BankingTransition["legs"] =
    plan.paid > 0
      ? [
          {
            kind: "debit",
            amount: plan.paid,
            collection: "centralBanks",
            filter: { _id: target.centralBankId, externalBroadMoney: { $gte: plan.paid } },
            path: "externalBroadMoney",
            note: "Collect the non-player tax slice from the household money stock",
          },
          {
            kind: "credit",
            amount: plan.paid,
            collection: "federalBudget",
            filter: { _id: target.budgetId },
            path: "treasuryCashLocal",
            note: "Deliver the non-player tax slice into spendable Treasury cash",
          },
        ]
      : [];
  return {
    key,
    kind: CONSERVED_FISCAL_TAX_KIND,
    turn: target.turn,
    currency: target.currency,
    legs,
    projections: [arrearsProjection(target, "householdTaxArrearsLocal", "taxCashIn", plan)],
    event: {
      kind: "monetary.executed",
      command: "turn.treasury.conservedTax",
      subjectType: "country",
      subjectId: target.countryId,
      amount: plan.paid,
      meta: planMeta(plan, { fundedRevenueReceipts: plan.fundedRevenueReceipts ?? 0 }),
    },
  };
}

/** Treasury pays the primary spending slice back into the household money stock. */
export function primarySpendingTransition(
  target: ConservedFiscalTarget,
  plan: ConservedFlowPlan,
  key = conservedFiscalKey("spending", target)
): BankingTransition {
  const legs: BankingTransition["legs"] =
    plan.paid > 0
      ? [
          {
            kind: "debit",
            amount: plan.paid,
            collection: "federalBudget",
            filter: { _id: target.budgetId, treasuryCashLocal: { $gte: plan.paid } },
            path: "treasuryCashLocal",
            note: "Pay the primary spending slice from spendable Treasury cash",
          },
          {
            kind: "credit",
            amount: plan.paid,
            collection: "centralBanks",
            filter: { _id: target.centralBankId },
            path: "externalBroadMoney",
            note: "Return primary spending to the household money stock",
          },
        ]
      : [];
  return {
    key,
    kind: CONSERVED_FISCAL_SPENDING_KIND,
    turn: target.turn,
    currency: target.currency,
    legs,
    projections: [
      arrearsProjection(target, "primarySpendingArrearsLocal", "spendingCashOut", plan),
    ],
    event: {
      kind: "monetary.executed",
      command: "turn.treasury.conservedSpending",
      subjectType: "country",
      subjectId: target.countryId,
      amount: plan.paid,
      meta: planMeta(plan),
    },
  };
}

/**
 * Bond-pool liquidity under conserved financing. The pool is the institutional
 * savers behind `publicFloat`; inflow toward its target is household money
 * moving into it, and a sweep is the same money moving back. Neither is a
 * mint or a burn.
 */
export function conservedPoolFlowTransition(input: {
  turn: number;
  currency: string;
  centralBankId: string;
  direction: "inflow" | "sweep";
  amount: number;
}): BankingTransition {
  const amount = roundCash(nonNegative(input.amount));
  const inflow = input.direction === "inflow";
  const household = {
    collection: "centralBanks",
    path: "externalBroadMoney",
  };
  const pool = { collection: "bondMarketPools", path: "cashLocal" };
  return {
    key: `conserved-bond-pool:${input.turn}:${input.currency}:${input.direction}`,
    kind: inflow ? CONSERVED_POOL_INFLOW_KIND : CONSERVED_POOL_SWEEP_KIND,
    turn: input.turn,
    currency: input.currency,
    legs: [
      {
        kind: "debit",
        amount,
        ...(inflow ? household : pool),
        filter: inflow
          ? { _id: input.centralBankId, externalBroadMoney: { $gte: amount } }
          : { _id: input.currency, cashLocal: { $gte: amount } },
        note: inflow
          ? "Household savings move into the bond market pool"
          : "Excess bond market pool cash returns to household savings",
      },
      {
        kind: "credit",
        amount,
        ...(inflow ? pool : household),
        filter: inflow ? { _id: input.currency } : { _id: input.centralBankId },
        note: inflow
          ? "Bond market pool receives household savings"
          : "Household savings receive the sweep",
      },
    ],
    projections: [
      {
        collection: "bondMarketPools",
        filter: { _id: input.currency },
        update: {
          $inc: { [`lifetime.${inflow ? "householdInflowIn" : "householdSweepOut"}`]: amount },
        },
        note: "Record conserved bond pool liquidity flow",
      },
    ],
    event: {
      kind: "monetary.executed",
      command: inflow ? "turn.bondPool.householdInflow" : "turn.bondPool.householdSweep",
      subjectType: "currency",
      subjectId: input.currency,
      amount,
    },
  };
}

/** A funded money stock in one currency, as the conservation check sees it. */
export interface ConservedStock {
  householdCash: number;
  treasuryCash: number;
  bondPoolCash: number;
  /** Player-owned balances in the currency that the financing loop can touch. */
  otherHolderCash: number;
}

export function totalConservedStock(stock: ConservedStock): number {
  return (
    nonNegative(stock.householdCash) +
    nonNegative(stock.treasuryCash) +
    nonNegative(stock.bondPoolCash) +
    nonNegative(stock.otherHolderCash)
  );
}

/**
 * Residual of a closed money system over an interval: closing stock minus
 * opening stock minus every explicit mint plus every explicit burn. Zero (to
 * the cent) means no money appeared or vanished outside a recorded door.
 */
export function conservationResidual(input: {
  opening: ConservedStock;
  closing: ConservedStock;
  explicitMint: number;
  explicitBurn: number;
}): number {
  return roundCash(
    totalConservedStock(input.closing) -
      totalConservedStock(input.opening) -
      nonNegative(input.explicitMint) +
      nonNegative(input.explicitBurn)
  );
}
