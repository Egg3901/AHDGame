/**
 * Index-fund bond reserve: buy real sovereign bonds from public float.
 * Coupon income is paid on the turn schedule via bondTurn (credited to
 * fund cashAnchor); the fund cron redeploys cash into bonds to maintain 25%.
 */

import { ObjectId, type Db } from "mongodb";
import type { Bond, IndexFund } from "@/lib/db/types";
import type { CountryId } from "@/lib/constants/countries";
import { COUNTRY_CURRENCY_MAP } from "@/lib/constants/currencies";
import { BOND_UNIT_FACE_VALUE } from "@/lib/db/types/bond";
import { corpCapitalToAnchor, loadFxRatesRecord } from "@/lib/currency/corporationCapital";
import { loadBondPoolsByCurrency } from "@/lib/bonds/marketPool";
import { purchaseBondUnitsForFund } from "@/lib/bonds/purchaseBondUnitsForFund";
import { computeFundAllocationBreakdown } from "@/lib/indexFunds/fundAllocation";
import { sovereignBondRemainingCapacityUnits } from "@/lib/bonds/holderCap";
import { getAllFundDefinitions, type BondFundUniverse } from "@/lib/indexFunds/fundDefinitions";
import { CREDIT_RATINGS, type CreditRating } from "@/lib/db/types/centralBank";
import { getNationalBudgetId } from "@/lib/bonds/sovereign";

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

function ratingIndex(rating: string | undefined, fallback: CreditRating = "BBB"): number {
  const idx = CREDIT_RATINGS.indexOf((rating ?? fallback) as CreditRating);
  return idx >= 0 ? idx : CREDIT_RATINGS.indexOf(fallback);
}

/** Inclusive rating bounds: `minRating` is the worst grade allowed, `maxRating` the best. */
export function ratingWithinUniverse(
  rating: string | undefined,
  universe: Pick<BondFundUniverse, "minRating" | "maxRating">
): boolean {
  const idx = ratingIndex(rating);
  if (universe.minRating && idx > CREDIT_RATINGS.indexOf(universe.minRating)) return false;
  if (universe.maxRating && idx < CREDIT_RATINGS.indexOf(universe.maxRating)) return false;
  return true;
}

/**
 * The bonds a bond fund may buy right now: its universe's issuer type, its
 * rating band (sovereign rating from the budget, corporate from the issuer's
 * snapshot), home paper only for country funds, and for global funds only
 * currencies with a live rate and no capital controls.
 */
export async function loadBondFundCandidates(
  db: Db,
  fund: Pick<IndexFund, "countryId" | "anchorCurrencyCode" | "scope">,
  universe: BondFundUniverse
): Promise<Bond[]> {
  const homeCountryId = resolveFundBondCountryId(fund);
  const query: Record<string, unknown> = {
    matured: false,
    defaulted: { $ne: true },
    publicFloat: { $gt: 0 },
    ...(universe.issuerType === "sovereign"
      ? { issuerType: "sovereign" }
      : { issuerType: { $ne: "sovereign" } }),
    ...(universe.homeOnly ? { countryId: homeCountryId } : {}),
  };
  const bonds = await db.collection<Bond>("bonds").find(query).toArray();
  if (bonds.length === 0) return [];

  let eligible = bonds;
  if (universe.minRating || universe.maxRating) {
    if (universe.issuerType === "sovereign") {
      const countryIds = [...new Set(bonds.flatMap((b) => (b.countryId ? [b.countryId] : [])))];
      const budgets = await db
        .collection<{ _id: string; creditRating?: string }>("federalBudget")
        .find(
          { _id: { $in: countryIds.map((id) => getNationalBudgetId(id)) } },
          { projection: { creditRating: 1 } }
        )
        .toArray();
      const ratingByBudgetId = new Map(budgets.map((b) => [String(b._id), b.creditRating]));
      eligible = bonds.filter(
        (b) =>
          b.countryId &&
          ratingWithinUniverse(ratingByBudgetId.get(getNationalBudgetId(b.countryId)), universe)
      );
    } else {
      const corpIds = [...new Set(bonds.map((b) => b.corporationId.toString()))];
      const corps = await db
        .collection<{ _id: ObjectId; creditRatingSnapshot?: string }>("corporations")
        .find(
          { _id: { $in: corpIds.map((id) => new ObjectId(id)) } },
          { projection: { creditRatingSnapshot: 1 } }
        )
        .toArray();
      const ratingByCorp = new Map(corps.map((c) => [c._id.toString(), c.creditRatingSnapshot]));
      eligible = bonds.filter((b) =>
        ratingWithinUniverse(ratingByCorp.get(b.corporationId.toString()), universe)
      );
    }
  }
  if (universe.homeOnly) return rankSovereignIssuesForBreadth(eligible);

  const currencyRows = await db
    .collection<{ currencyCode?: string; rate?: number; capitalControls?: boolean }>(
      "exchangeRates"
    )
    .find({})
    .project({ currencyCode: 1, rate: 1, capitalControls: 1 })
    .toArray();
  const tradable = new Set(
    currencyRows.flatMap((row) =>
      row.currencyCode && typeof row.rate === "number" && row.rate > 0 ? [row.currencyCode] : []
    )
  );
  const controlled = new Set(
    currencyRows.flatMap((row) =>
      row.currencyCode && row.capitalControls === true ? [row.currencyCode] : []
    )
  );
  return rankSovereignIssuesForBreadth(
    eligible.filter((bond) => isGlobalFundBondEligible(bond, homeCountryId, tradable, controlled))
  ).slice(0, MAX_GLOBAL_SOVEREIGN_ISSUES_PER_PASS);
}

/**
 * Buy bonds from the market pool until the fund's bond target is met: the
 * 25% reserve floor for equity funds, everything past the cash buffer for a
 * bond fund (which draws on its definition's universe instead of home
 * sovereign paper).
 */
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
  const bondUniverse =
    fund.kind === "bond"
      ? getAllFundDefinitions().find((d) => d.slug === fund.slug)?.bondUniverse
      : undefined;
  if (fund.kind === "bond" && !bondUniverse) {
    return { deployedAnchor: 0, unitsPurchased: 0, countryId };
  }
  const globalDemandEnabled = options?.liquidityTargetEnabled === true && fund.scope === "global";
  const bondQuery = {
    issuerType: "sovereign",
    ...(globalDemandEnabled ? {} : { countryId }),
    matured: false,
    defaulted: { $ne: true },
    publicFloat: { $gt: 0 },
  } as const;
  let bonds = bondUniverse
    ? await loadBondFundCandidates(db, fund, bondUniverse)
    : await db
        .collection<Bond>("bonds")
        .find(bondQuery)
        .sort({ maturityTurn: 1, publicFloat: -1 })
        .toArray();

  if (globalDemandEnabled && !bondUniverse) {
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
  // One pool read for the whole pass; each purchase advances the snapshot.
  const bondPools = await loadBondPoolsByCurrency(db);
  let deployedAnchor = 0;
  let unitsPurchased = 0;

  for (let index = 0; index < bonds.length; index++) {
    const bond = bonds[index]!;
    if (budgetAnchor <= 0) break;

    const unitCostAnchor = costPerUnitAnchor(bond, fxRates);
    if (unitCostAnchor <= 0) continue;

    const issueBudgetAnchor =
      options?.liquidityTargetEnabled || bondUniverse
        ? bondAllocationBudgetForIssue(budgetAnchor, bonds.length - index)
        : budgetAnchor;
    const maxUnitsByBudget = Math.floor(issueBudgetAnchor / unitCostAnchor);
    const maxUnitsByFloat = Math.floor(bond.publicFloat ?? 0);
    const maxUnitsByPosition = sovereignBondRemainingCapacityUnits(bond, "fundId", fund._id);
    const units = Math.min(maxUnitsByBudget, maxUnitsByFloat, maxUnitsByPosition);
    if (units <= 0) continue;

    const purchase = await purchaseBondUnitsForFund(db, fund, bond, units, { bondPools });
    if (!purchase.ok) continue;

    deployedAnchor += purchase.costAnchor;
    unitsPurchased += purchase.units;
    budgetAnchor -= purchase.costAnchor;
    // The purchase debits fund cash atomically; nothing below reads the
    // fund's cash, so no re-read per bond. `budgetAnchor` is the running cap.
  }

  return { deployedAnchor, unitsPurchased, countryId };
}
