import { oid, type BankingTransition } from "@/lib/banking/rules/boundary";
import type { BankCharter } from "@/lib/db/types/bank";
import { cashBackedDeposits, getCashReserves } from "@/lib/banking/rules/balanceSheet";

export type FinancialRescueResponse = "recapitalize" | "guarantee" | "resolve";

export function financialInterventionAmount(gdp: number, pctGdp: number): number {
  return Number.isFinite(gdp) && Number.isFinite(pctGdp)
    ? Math.max(0, Math.round(gdp * Math.max(0, pctGdp)))
    : 0;
}

/** Cash needed to cover depositors after the existing secured-creditor tier. */
export function guaranteedDepositorShortfall(
  charter: BankCharter,
  playerDepositsAreLiabilities: boolean
): number {
  const secured = [
    charter.discountWindowDebt,
    charter.discountWindowArrears,
    charter.cbMarginDebt,
    charter.cbMarginArrears,
  ].reduce<number>((sum, amount) => sum + Math.max(0, amount ?? 0), 0);
  const deposits = cashBackedDeposits(charter, { playerDepositsAreLiabilities });
  return deposits > 0 ? Math.max(0, deposits + secured - getCashReserves(charter)) : 0;
}

/** Capital is an equity projection, never a second cash credit. */
export function financialRescueTransition(input: {
  key: string;
  countryId: string;
  treasuryId: string;
  currency: string;
  turn: number;
  amount: number;
  response: FinancialRescueResponse;
  banks: { id: string; confidence: number }[];
  treasuryCashLedgerEnabled?: boolean;
}): BankingTransition {
  const { key, countryId, currency, turn, amount, response, banks } = input;
  const transition: BankingTransition = {
    key,
    kind: `financial_crisis_${response}`,
    currency,
    turn,
    legs: [],
    projections: [],
    event: {
      kind: response === "resolve" ? "bank.failed" : "account.deposited",
      command: `financial_crisis.${response}`,
      amount,
      subjectType: "country",
      subjectId: countryId,
    },
  };
  if (response === "resolve") {
    const weakest = banks[0];
    if (weakest && weakest.confidence <= 0.35)
      transition.projections.push({
        collection: "corporations",
        filter: { _id: oid(weakest.id) },
        update: { $set: { "bankCharter.status": "failed", "bankCharter.failedTurn": turn } },
        note: "Resolve the insolvent domestic bank through the depositor waterfall",
      });
    return transition;
  }
  if (!(amount > 0) || banks.length === 0)
    throw new Error("Rescue needs funding and eligible banks");
  transition.legs.push({
    kind: "debit",
    amount,
    collection: "federalBudget",
    filter: input.treasuryCashLedgerEnabled
      ? { _id: input.treasuryId, countryId, treasuryCashLocal: { $gte: amount } }
      : { _id: input.treasuryId, countryId },
    path: input.treasuryCashLedgerEnabled ? "treasuryCashLocal" : "treasuryBalance",
    note: "Fund the authorized crisis intervention",
  });
  if (input.treasuryCashLedgerEnabled) {
    transition.projections.push({
      collection: "federalBudget",
      filter: { _id: input.treasuryId, countryId },
      update: { $inc: { treasuryBalance: -amount } },
      note: "Keep the signed fiscal-position record aligned with the funded cash draw",
    });
  }
  if (response === "guarantee") {
    transition.legs.push({
      kind: "credit",
      amount,
      collection: "bankGuarantees",
      filter: { _id: key },
      path: "escrowBalance",
      note: "Reserve cash for covered depositor claims",
    });
    transition.projections.push({
      collection: "bankGuarantees",
      filter: { _id: key },
      update: { $set: { status: "active" } },
      note: "Activate only the funded guarantee",
    });
    return transition;
  }
  const perBank = Math.floor(amount / banks.length);
  banks.forEach((bank, index) => {
    const allocation = perBank + (index < amount % banks.length ? 1 : 0);
    if (!(allocation > 0)) return;
    transition.legs.push({
      kind: "credit",
      amount: allocation,
      collection: "corporations",
      filter: { _id: oid(bank.id) },
      path: "bankCharter.cashReserves",
      note: "Deliver taxpayer capital into the bank ring fence",
    });
    transition.projections.push({
      collection: "corporations",
      filter: { _id: oid(bank.id) },
      update: {
        $inc: {
          "bankCharter.postedCapital": allocation,
          "bankCharter.publicRescueCapital": allocation,
        },
        $set: { "bankCharter.panicTurns": 0 },
      },
      note: "Record funded public capital and terminate the bank run",
    });
  });
  return transition;
}
