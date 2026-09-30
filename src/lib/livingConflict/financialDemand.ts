import { resolveCountryCurrencyCode } from "@/lib/currency/govBudgetFields";
import type { Db } from "mongodb";
import type { Corporation, FederalBudget } from "@/lib/db/types";
import { GLOBAL_FINANCIAL_CRISIS_KEY } from "./financialCrisisKey";
import {
  FINANCIAL_DEMAND_WINDOW,
  financialHouseholdDemandMultiplier,
} from "./rules/financialDemand";

interface CreditHistory {
  _id: string;
  observations: { turn: number; credit: number }[];
}

/** Reuses the commodity pass's projected charters and budgets. */
export async function loadFinancialCrisisDemand(
  db: Db,
  turn: number,
  banks: Pick<Corporation, "countryId" | "bankCharter">[],
  budgets: Pick<FederalBudget, "countryId" | "gdp" | "gdpSmoothed" | "currencyCode">[]
): Promise<Map<string, number>> {
  const crisis = await db
    .collection("livingConflicts")
    .findOne({ defKey: GLOBAL_FINANCIAL_CRISIS_KEY, hasOpened: true }, { projection: { _id: 1 } });
  if (!crisis) return new Map();
  const [actions, history] = await Promise.all([
    db
      .collection<{ countryId: string; amount: number }>("financialCrisisFiscalActions")
      .find(
        { response: "stimulus", turn: { $gt: turn - FINANCIAL_DEMAND_WINDOW, $lte: turn } },
        { projection: { countryId: 1, amount: 1 } }
      )
      .toArray(),
    db.collection<CreditHistory>("financialCrisisCreditHistory").find({}).toArray(),
  ]);
  const credit = new Map<string, number>();
  for (const bank of banks)
    if (
      bank.bankCharter?.status === "active" &&
      bank.bankCharter.currency ===
        resolveCountryCurrencyCode(budgets.find((budget) => budget.countryId === bank.countryId))
    ) {
      credit.set(
        bank.countryId,
        (credit.get(bank.countryId) ?? 0) + Math.max(0, bank.bankCharter.totalLoans ?? 0)
      );
    }
  const multipliers = new Map<string, number>();
  for (const budget of budgets) {
    const observations = (
      history.find((row) => row._id === budget.countryId)?.observations ?? []
    ).filter((row) => row.turn >= turn - FINANCIAL_DEMAND_WINDOW && row.turn < turn);
    const currentCredit = credit.get(budget.countryId) ?? 0;
    const referenceCredit = Math.max(currentCredit, ...observations.map((row) => row.credit));
    const settledStimulus = actions
      .filter((row) => row.countryId === budget.countryId)
      .reduce((sum, row) => sum + row.amount, 0);
    multipliers.set(
      budget.countryId,
      financialHouseholdDemandMultiplier({
        gdp: budget.gdpSmoothed || budget.gdp,
        settledStimulus,
        currentCredit,
        referenceCredit,
      })
    );
    await db.collection<CreditHistory>("financialCrisisCreditHistory").updateOne(
      { _id: budget.countryId },
      {
        $set: {
          observations: [...observations, { turn, credit: currentCredit }],
        },
      },
      { upsert: true }
    );
  }
  return multipliers;
}
