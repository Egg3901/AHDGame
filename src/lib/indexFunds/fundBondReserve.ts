/**
 * Index-fund bond reserve: buy real sovereign bonds from public float.
 * Coupon income is paid on the turn schedule via bondTurn (credited to
 * fund cashAnchor); the fund cron redeploys cash into bonds to maintain 25%.
 */

import type { Db } from "mongodb";
import type { Bond, IndexFund } from "@/lib/db/types";
import type { CountryId } from "@/lib/constants/countries";
import { COUNTRY_CURRENCY_MAP } from "@/lib/constants/currencies";
import { BOND_UNIT_FACE_VALUE } from "@/lib/db/types/bond";
import { corpCapitalToAnchor, loadFxRatesRecord } from "@/lib/currency/corporationCapital";
import { purchaseBondUnitsForFund } from "@/lib/bonds/purchaseBondUnitsForFund";
import { computeFundAllocationBreakdown } from "@/lib/indexFunds/fundAllocation";
import { sovereignBondRemainingCapacityUnits } from "@/lib/bonds/holderCap";

export const MAX_GLOBAL_SOVEREIGN_ISSUES_PER_PASS = 48;

export function resolveFundBondCountryId(
  fund: Pick<IndexFund, "countryId" | "anchorCurrencyCode" | "scope">
): CountryId {
  if (fund.countryId) return fund.countryId;

  const byCurrency = Object.entries(COUNTRY_CURRENCY_MAP).find(
    ([, currency]) => currency === fund.anchorCurrencyCode
  );
  if (byCurrency) return byCurrency[0] as CountryId;

  return "US";
}

export type DeployBondReserveResult = {
  deployedAnchor: number;
  unitsPurchased: number;
  countryId: CountryId;
};

/** Equal-notional auction slice, recomputed as issues fill so leftovers redistribute. */
export function bondAllocationBudgetForIssue(
  remainingBudgetAnchor: number,
  remainingIssueCount: number
): number {
  if (!(remainingBudgetAnchor > 0) || remainingIssueCount <= 0) return 0;
  return remainingBudgetAnchor / remainingIssueCount;
}

function costPerUnitAnchor(bond: Bond, fxRates: Record<string, number>): number {
  const bondCurrency = bond.currencyCode ?? "USD";
  const fx = fxRates[bondCurrency] && fxRates[bondCurrency]! > 0 ? fxRates[bondCurrency]! : 1;
  const costLocal = BOND_UNIT_FACE_VALUE * bond.marketPrice;
  return corpCapitalToAnchor(costLocal, bondCurrency, fx);
}

function bondCurrencyCode(bond: Bond): string {
  return (
    bond.currencyCode ??
    (bond.countryId ? COUNTRY_CURRENCY_MAP[bond.countryId] : undefined) ??
    "USD"
  );
}

export function isGlobalFundBondEligible(
  bond: Bond,
  homeCountryId: CountryId,
  tradableCurrencies: ReadonlySet<string>,
  controlledCurrencies: ReadonlySet<string>
): boolean {
  if (bond.countryId === homeCountryId) return true;
  const currencyCode = bondCurrencyCode(bond);
  return tradableCurrencies.has(currencyCode) && !controlledCurrencies.has(currencyCode);
}

export function rankSovereignIssuesForBreadth(bonds: Bond[]): Bond[] {
  return [...bonds].sort((a, b) => {
    const aHeld = a.holders.some((holder) => holder.units > 0) ? 1 : 0;
    const bHeld = b.holders.some((holder) => holder.units > 0) ? 1 : 0;
    return (
      aHeld - bHeld ||
      String(a.countryId ?? "").localeCompare(String(b.countryId ?? "")) ||
      a.maturityTurn - b.maturityTurn ||
      a._id.toString().localeCompare(b._id.toString())
    );
  });
}

/** Buy sovereign bonds from public float until the 25% reserve floor is met. */
export async function deployBondReserveFromCash(
  db: Db,
  fund: IndexFund,
  bondPrincipalAnchor: number,
  options?: { liquidityTargetEnabled?: boolean }
): Promise<DeployBondReserveResult> {
  const breakdown = computeFundAllocationBreakdown(fund, {
    bondPrincipalAnchor,
    bondLiquidityTargetEnabled: options?.liquidityTargetEnabled,
  });
  let budgetAnchor = Math.min(
    breakdown.bondDeploymentNeededAnchor,
    breakdown.cashAvailableForBondDeployAnchor
  );

  if (budgetAnchor <= 0) {
    return { deployedAnchor: 0, unitsPurchased: 0, countryId: resolveFundBondCountryId(fund) };
  }

  const countryId = resolveFundBondCountryId(fund);
  const globalDemandEnabled = options?.liquidityTargetEnabled === true && fund.scope === "global";
  const bondQuery = {
    issuerType: "sovereign",
    ...(globalDemandEnabled ? {} : { countryId }),
    matured: false,
    defaulted: { $ne: true },
    publicFloat: { $gt: 0 },
  } as const;
  let bonds = await db
    .collection<Bond>("bonds")
    .find(bondQuery)
    .sort({ maturityTurn: 1, publicFloat: -1 })
    .toArray();

  if (globalDemandEnabled) {
    const currencyRows = await db
      .collection<{ currencyCode?: string; rate?: number; capitalControls?: boolean }>(
        "exchangeRates"
      )
      .find({})
      .project({ currencyCode: 1, rate: 1, capitalControls: 1 })
      .toArray();
    const tradableCurrencies = new Set(
      currencyRows.flatMap((row) =>
        row.currencyCode && typeof row.rate === "number" && row.rate > 0 ? [row.currencyCode] : []
      )
    );
    const controlledCurrencies = new Set(
      currencyRows.flatMap((row) =>
        row.currencyCode && row.capitalControls === true ? [row.currencyCode] : []
      )
    );
    bonds = rankSovereignIssuesForBreadth(
      bonds.filter((bond) =>
        isGlobalFundBondEligible(bond, countryId, tradableCurrencies, controlledCurrencies)
      )
    ).slice(0, MAX_GLOBAL_SOVEREIGN_ISSUES_PER_PASS);
  }

  if (bonds.length === 0) {
    return { deployedAnchor: 0, unitsPurchased: 0, countryId };
  }

  const fxRates = await loadFxRatesRecord(db);
  let deployedAnchor = 0;
  let unitsPurchased = 0;

  for (let index = 0; index < bonds.length; index++) {
    const bond = bonds[index]!;
    if (budgetAnchor <= 0) break;

    const unitCostAnchor = costPerUnitAnchor(bond, fxRates);
    if (unitCostAnchor <= 0) continue;

    const issueBudgetAnchor = options?.liquidityTargetEnabled
      ? bondAllocationBudgetForIssue(budgetAnchor, bonds.length - index)
      : budgetAnchor;
    const maxUnitsByBudget = Math.floor(issueBudgetAnchor / unitCostAnchor);
    const maxUnitsByFloat = Math.floor(bond.publicFloat ?? 0);
    const maxUnitsByPosition = sovereignBondRemainingCapacityUnits(bond, "fundId", fund._id);
    const units = Math.min(maxUnitsByBudget, maxUnitsByFloat, maxUnitsByPosition);
    if (units <= 0) continue;

    const purchase = await purchaseBondUnitsForFund(db, fund, bond, units);
    if (!purchase.ok) continue;

    deployedAnchor += purchase.costAnchor;
    unitsPurchased += purchase.units;
    budgetAnchor -= purchase.costAnchor;

    const refreshed = await db.collection<IndexFund>("indexFunds").findOne({ _id: fund._id });
    if (refreshed) fund = refreshed;
  }

  return { deployedAnchor, unitsPurchased, countryId };
}
