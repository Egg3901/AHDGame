/**
 * Primary sovereign financing has one cash destination: the issuer treasury.
 * Pool purchases transfer existing cash; central-bank purchases explicitly mint
 * it. Only funded face becomes principal and coupon obligations. The journal
 * owns both the cash legs and the accompanying debt projections.
 */
import type { BankingTransition } from "@/lib/banking/rules/boundary";

export interface SovereignPrimaryFunding {
  key: string;
  turn: number;
  currency: string;
  budgetId: string;
  poolCash: number;
  monetaryCash: number;
  centralBankId?: string;
  face: number;
  annualCoupon: number;
}

export function sovereignPrimaryTransition(input: SovereignPrimaryFunding): BankingTransition {
  for (const value of [input.poolCash, input.monetaryCash, input.face, input.annualCoupon]) {
    if (!Number.isFinite(value) || value < 0) throw new Error("Invalid sovereign financing");
  }
  if (input.monetaryCash > 0 && !input.centralBankId) {
    throw new Error("Monetary financing requires a central bank");
  }
  if (input.face > 0 !== input.poolCash + input.monetaryCash > 0) {
    throw new Error("Sovereign face must have a funding source");
  }
  const transition: BankingTransition = {
    key: input.key,
    kind: "sovereign_primary_placement",
    turn: input.turn,
    currency: input.currency,
    legs: [],
    projections: [],
    event: { kind: "sovereign.primary_placed", command: "sovereign.primary.place" },
  };
  if (input.poolCash > 0) {
    transition.legs.push({
      kind: "debit",
      amount: input.poolCash,
      collection: "bondMarketPools",
      filter: { _id: input.currency },
      path: "cashLocal",
      note: "Primary buyer pays issuer",
    });
    transition.projections.push({
      collection: "bondMarketPools",
      filter: { _id: input.currency },
      update: { $inc: { "lifetime.issuanceOut": input.poolCash } },
      note: "Primary cash turnover",
    });
  }
  if (input.monetaryCash > 0) {
    transition.legs.push({
      kind: "mint",
      amount: input.monetaryCash,
      note: "Central-bank primary financing",
    });
    transition.projections.push({
      collection: "centralBanks",
      filter: { _id: input.centralBankId },
      update: {
        $inc: { netMoneyCreatedLifetime: input.monetaryCash },
        $set: { lastMonetaryOperationTurn: input.turn },
      },
      note: "Monetary financing memo, cash is held by the treasury",
    });
  }
  const cash = input.poolCash + input.monetaryCash;
  if (cash > 0) {
    transition.legs.push({
      kind: "credit",
      amount: cash,
      collection: "federalBudget",
      filter: { _id: input.budgetId },
      path: "treasuryBalance",
      note: "Issuer receives funded proceeds",
    });
    transition.projections.push({
      collection: "federalBudget",
      filter: { _id: input.budgetId },
      update: {
        $inc: {
          "debt.principal": input.face,
          "spending.debtInterest": input.annualCoupon,
          "spending.total": input.annualCoupon,
          surplus: -input.annualCoupon,
        },
      },
      note: "Funded principal and annual coupon obligation",
    });
  }
  return transition;
}
