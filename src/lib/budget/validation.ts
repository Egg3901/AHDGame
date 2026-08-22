/**
 * Budget validation (spending caps, debt ceiling, insufficient funds).
 *
 * **Currency (v0.2.6):** Compares bill cost → budget balance/revenue/spending
 * all within a single country's currency. `calculatePolicyOptionAnnualCost`
 * returns the same country-local currency as the budget it's validated against,
 * so `<=` / `>=` comparisons remain meaningful. No cross-country checks.
 */
import type { Db } from "mongodb";
import { effectiveBorrowingLimit } from "@/lib/budget/borrowingLimit";
import { COST_INCOME_ANCHORS } from "@/lib/politicalLegislation/costAnchors";
import { countryFiscalBase, regionFiscalBase } from "@/lib/politicalLegislation/fiscalBase";
import type { FederalBudget, StateBudget } from "@/lib/db/types/budget";
import type { Bill, LegislationType } from "@/lib/db/types/legislation";
import { isPolicyProvision } from "@/lib/db/types/legislation";
import type { State } from "@/lib/db/types/state";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import {
  calculatePolicyOptionAnnualCost,
  getSelectedPolicyOption,
  type BudgetCostContext,
} from "./costs";
import { resolveNationalGdpPerCapita, resolveNationalMedianIncome } from "./spending";
import { getEraContext } from "@/lib/era/context";

/** Era year for the cost basis; defensive so a mock db (no gameState) ⇒ flag off. */
async function resolveEraYear(db: Db): Promise<number | null> {
  try {
    return (await getEraContext(db)).year;
  } catch {
    return null;
  }
}

export interface BudgetValidationResult {
  allowed: boolean;
  error?: "INSUFFICIENT_FUNDS" | "DEBT_CEILING_EXCEEDED";
  warning?: "DEBT_CEILING_EXCEEDED" | "HIGH_DEBT";
  costAmount: number;
  newTotalSpending: number;
  newBalance?: number;
  newDebt?: number;
  shortfall?: number;
}

function getBillSelections(
  bill: Pick<Bill, "legislationTypeId" | "effectDirection" | "provisions">
) {
  if (bill.provisions?.length) {
    return bill.provisions.filter(isPolicyProvision).map((provision) => ({
      legislationTypeId: provision.legislationTypeId,
      policyOptionId: provision.policyOptionId,
      effectDirection: provision.effectDirection,
    }));
  }

  if (bill.legislationTypeId && bill.effectDirection != null) {
    return [
      {
        legislationTypeId: bill.legislationTypeId,
        effectDirection: bill.effectDirection,
      },
    ];
  }

  return [];
}

async function getCountryPopulation(db: Db, countryId: CountryId): Promise<number> {
  const states = await db.collection<State>("states").find({ countryId }).toArray();
  return states.reduce((sum, state) => sum + (state.population ?? 0), 0);
}

async function calculateBillAnnualCost(
  db: Db,
  bill: Pick<Bill, "legislationTypeId" | "effectDirection" | "provisions">,
  context: BudgetCostContext
): Promise<number> {
  const selections = getBillSelections(bill);
  if (selections.length === 0) return 0;

  const legislationTypeIds = [
    ...new Set(selections.map((selection) => selection.legislationTypeId)),
  ];
  const legislationTypes = await db
    .collection<LegislationType>("legislationTypes")
    .find({ _id: { $in: legislationTypeIds } })
    .toArray();
  const legislationTypeMap = new Map(
    legislationTypes.map((legislationType) => [legislationType._id, legislationType])
  );

  return selections.reduce((total, selection) => {
    const legislationType = legislationTypeMap.get(selection.legislationTypeId);
    if (!legislationType) return total;

    const selectedPolicyOption = getSelectedPolicyOption(legislationType, selection);
    const formulaCost = calculatePolicyOptionAnnualCost(
      selectedPolicyOption,
      context,
      legislationType._id
    );
    const legacyCost = (legislationType.budgetCost || 0) * (context.budgetCapacity / 100);

    return total + (formulaCost ?? legacyCost);
  }, 0);
}

export async function validateFederalBudgetImpact(
  db: Db,
  bill: Pick<Bill, "legislationTypeId" | "effectDirection" | "provisions">,
  budgetId: string = "federal"
): Promise<BudgetValidationResult> {
  const federalBudget = await db
    .collection<FederalBudget>("federalBudget")
    .findOne({ _id: budgetId });
  if (!federalBudget) {
    return { allowed: true, costAmount: 0, newTotalSpending: 0 };
  }

  const budgetCountryId = (federalBudget.countryId ||
    (federalBudget._id === COUNTRY_CONFIGS.UK.id
      ? COUNTRY_CONFIGS.UK.id
      : COUNTRY_CONFIGS.US.id)) as CountryId;
  const population = await getCountryPopulation(db, budgetCountryId);
  const costAmount = await calculateBillAnnualCost(db, bill, {
    budgetCapacity: federalBudget.revenue.total,
    gdp: federalBudget.gdp,
    population,
    countryId: budgetCountryId,
    nationalGdpPerCapita: population > 0 ? federalBudget.gdp / population : undefined,
    nationalMedianIncome: await resolveNationalMedianIncome(db, budgetCountryId),
    year: await resolveEraYear(db),
    // costModelV2 laws are priced on the REGIONAL-ROLLUP base and throw outright
    // without it — "costModelV2 pricing requires v2Base and a
    // political-legislation countryId". spending.ts already threads these two;
    // this gate did not, so every budget validation of a v2 law for a
    // COST_INCOME_ANCHORS country (US/UK/RU/DD) failed. The gate then FAILS OPEN,
    // so bills were being waved through unpriced rather than blocked.
    v2Base:
      budgetCountryId in COST_INCOME_ANCHORS
        ? await countryFiscalBase(db, budgetCountryId)
        : undefined,
    incomeBandIndex: (await getEraContext(db)).incomeBandIndexByCountry?.[budgetCountryId] ?? null,
  });
  if (costAmount === 0) {
    return { allowed: true, costAmount: 0, newTotalSpending: federalBudget.spending.total };
  }

  const newTotalSpending = federalBudget.spending.total + costAmount;
  const newDeficit = newTotalSpending - federalBudget.revenue.total;
  const newDebt =
    newDeficit > 0 ? federalBudget.debt.principal + newDeficit : federalBudget.debt.principal;

  const result: BudgetValidationResult = {
    allowed: true,
    costAmount,
    newTotalSpending,
    newDebt,
  };

  const borrowingLimit = effectiveBorrowingLimit({
    countryId: budgetCountryId,
    gdp: federalBudget.gdpSmoothed ?? federalBudget.gdp,
    storedCeiling: federalBudget.debt.ceiling,
  });
  if (newDebt > borrowingLimit) {
    result.warning = "DEBT_CEILING_EXCEEDED";
  } else if (federalBudget.debtToGdpRatio > 1.0) {
    result.warning = "HIGH_DEBT";
  }

  return result;
}

export async function validateStateBudgetImpact(
  db: Db,
  stateId: string,
  countryId: CountryId,
  bill: Pick<Bill, "legislationTypeId" | "effectDirection" | "provisions">
): Promise<BudgetValidationResult> {
  const stateBudget = await db
    .collection<StateBudget>("stateBudgets")
    .findOne({ _id: stateId, countryId });
  if (!stateBudget) {
    return { allowed: true, costAmount: 0, newTotalSpending: 0 };
  }

  const state = await db.collection<State>("states").findOne({ _id: stateId, countryId });
  const costAmount = await calculateBillAnnualCost(db, bill, {
    budgetCapacity: stateBudget.revenue.total,
    gdp: stateBudget.stateGdp,
    population: state?.population ?? 0,
    countryId,
    nationalGdpPerCapita: await resolveNationalGdpPerCapita(db, countryId),
    nationalMedianIncome: await resolveNationalMedianIncome(db, countryId),
    year: await resolveEraYear(db),
    // Regional twin of the national fix above — priced on this region's own base.
    v2Base: countryId in COST_INCOME_ANCHORS ? await regionFiscalBase(db, stateId) : undefined,
    incomeBandIndex: (await getEraContext(db)).incomeBandIndexByCountry?.[countryId] ?? null,
  });
  if (costAmount === 0) {
    return { allowed: true, costAmount: 0, newTotalSpending: stateBudget.spending.total };
  }

  const newTotalSpending = stateBudget.spending.total + costAmount;
  const availableFunds = stateBudget.revenue.total + stateBudget.balance;

  if (newTotalSpending > availableFunds) {
    return {
      allowed: false,
      error: "INSUFFICIENT_FUNDS",
      costAmount,
      newTotalSpending,
      shortfall: newTotalSpending - availableFunds,
    };
  }

  return {
    allowed: true,
    costAmount,
    newTotalSpending,
    newBalance: availableFunds - newTotalSpending,
  };
}

export async function validateBudgetImpact(
  db: Db,
  bill: Pick<Bill, "legislationTypeId" | "effectDirection" | "provisions">,
  scope: "national" | "state",
  options: { stateId?: string; countryId?: CountryId; budgetId?: string } = {}
): Promise<BudgetValidationResult> {
  if (scope === "national") {
    return validateFederalBudgetImpact(db, bill, options.budgetId);
  } else if (options.stateId && options.countryId) {
    return validateStateBudgetImpact(db, options.stateId, options.countryId, bill);
  }

  return { allowed: true, costAmount: 0, newTotalSpending: 0 };
}
