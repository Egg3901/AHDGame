/**
 * Federal / state spending projections derived from enacted laws.
 *
 * **Currency (v0.2.6):** Budget, enacted-law costs (see `billEnactment.ts` doc),
 * GDP, and state grants are all in the owning country's currency. This file
 * performs same-currency arithmetic only; cross-country aggregation does not
 * happen here. No FX conversion is required.
 */
import type { Db } from "mongodb";
import type { EnactedLaw, FederalBudget, StateBudget } from "@/lib/db/types/budget";
import type { State } from "@/lib/db/types/state";
import type { RegionalBudget } from "@/lib/db/types/regionalBudget";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { getNationalBudgetId } from "@/lib/bonds/sovereign";
import { nationalLawCountryQuery } from "@/lib/policy/nationalPolicyRecords";
import { calculateEnactedLawAnnualCost } from "./costs";
import { COST_INCOME_ANCHORS } from "@/lib/politicalLegislation/costAnchors";
import { countryFiscalBase, regionFiscalBase } from "@/lib/politicalLegislation/fiscalBase";
import { getEraContext, type EraContext } from "@/lib/era/context";
import { isPlannedEconomy } from "@/lib/constants/commandEconomy";
import { isLegislationTypeActive } from "@/lib/era/legislationCatalog";
import { getNationalDocId } from "@/lib/constants/nationalScope";
import type { StateMetrics } from "@/lib/db/types/stateMetrics";
import { keepLatestActiveLawPerType } from "./keepLatestActiveLawPerType";

// Re-exported so existing importers of `./spending` keep working.
export { keepLatestActiveLawPerType } from "./keepLatestActiveLawPerType";

export const SECTOR_SUBSIDIES_SPENDING_KEY = "sectorSubsidies";

/**
 * Countries whose central transfer grant pool is derived from a config constant
 * in their regional-budget processor (CN 中央转移支付; DE Länderfinanzausgleich)
 * rather than an enacted `isGrant` national law. For these, the pool is credited
 * to regions but has no enacted law to book it as national spending, so
 * `calculateFederalSpending` must add the actually-distributed total to
 * `stateGrants`. UK joined them once the v2 catalog retired
 * `uk_local_government_funding`; JP is still absent because its Local Allocation
 * Tax Act is a real isGrant law that books the grant itself. The mapped value is
 * the `regionalBudgets` field that holds each region's received grant.
 */
const CONFIG_DERIVED_TRANSFER_FIELD: Partial<
  Record<
    CountryId,
    "centralTransferGrant" | "federalEqualizationGrant" | "westminsterGrant" | "unionGrant"
  >
> = {
  CN: "centralTransferGrant",
  DE: "federalEqualizationGrant",
  // DD funds its Länder from the same config-derived equalization pool DE does
  // (see `federalEqualizationGrantPerCapita` on the DD config), and had the same
  // hole: the 16 Länder were each credited a transfer that `spending.stateGrants`
  // recorded as DDM 0, so DDM 8.0B/yr showed up as regional income with no national
  // expense (#1323). Booked under the plan-economy lapse rule below — DD is
  // marketization level 0, so an allocation a Land never draws down lapses
  // rather than being charged to the centre.
  DD: "federalEqualizationGrant",
  // UK joined this set when the political-legislation v2 catalog retired
  // `uk_local_government_funding`: with no isGrant law left to book it, the
  // Westminster grant is a config-derived pool like CN's and DE's, and the
  // regional processor now draws it from `spending.stateGrants` /
  // `baselineStateGrants`. Booking it back here closes the loop — otherwise
  // regions spend a £250M/yr transfer the national budget never records.
  // Stable, not circular: the per-region shares sum to the pool, so the
  // next sync reads back the same figure it wrote.
  UK: "westminsterGrant",
  // RU distributes its whole regional budget as a population share of the
  // central grants pool and, like CN/DE/UK, has no isGrant law to book it — the
  // union was handing its republics ₽44.00B a year that the national budget
  // recorded as ₽0. Booked under the plan-economy lapse rule below, so what the
  // republics never draw down is not charged to the centre.
  RU: "unionGrant",
};

function sumSpendingByCategory(byCategory: Record<string, number>): number {
  return Object.values(byCategory).reduce((sum, amount) => sum + amount, 0);
}

const EMPTY_FEDERAL_SPENDING: FederalBudget["spending"] = {
  byCategory: {},
  stateGrants: 0,
  debtInterest: 0,
  total: 0,
};

const EMPTY_STATE_SPENDING: StateBudget["spending"] = {
  byCategory: {},
  total: 0,
};

export function normalizeFederalSpending(
  spending: FederalBudget["spending"] | null | undefined
): FederalBudget["spending"] {
  const safeSpending = spending ?? EMPTY_FEDERAL_SPENDING;
  const byCategory = {
    ...(safeSpending.byCategory ?? {}),
    [SECTOR_SUBSIDIES_SPENDING_KEY]: safeSpending.byCategory?.[SECTOR_SUBSIDIES_SPENDING_KEY] ?? 0,
  };
  const stateGrants = safeSpending.stateGrants ?? 0;
  const debtInterest = safeSpending.debtInterest ?? 0;

  return {
    byCategory,
    stateGrants,
    debtInterest,
    total: sumSpendingByCategory(byCategory) + stateGrants + debtInterest,
  };
}

export function normalizeStateSpending(
  spending: StateBudget["spending"] | null | undefined
): StateBudget["spending"] {
  const safeSpending = spending ?? EMPTY_STATE_SPENDING;
  const byCategory = {
    ...(safeSpending.byCategory ?? {}),
    [SECTOR_SUBSIDIES_SPENDING_KEY]: safeSpending.byCategory?.[SECTOR_SUBSIDIES_SPENDING_KEY] ?? 0,
  };
  // Persistent state-prospecting spend line, preserved across the annual
  // recompute (the spending-side mirror of revenue.resourceRoyalties). Folded
  // into `total` so a state-funded survey stays booked as spending.
  const resourceProspecting = safeSpending.resourceProspecting ?? 0;

  return {
    byCategory,
    resourceProspecting,
    total: sumSpendingByCategory(byCategory) + resourceProspecting,
  };
}

async function getCountryPopulation(db: Db, countryId: CountryId): Promise<number> {
  const states = await db
    .collection<State>("states")
    .find({ countryId }, { projection: { population: 1 } })
    .toArray();
  return states.reduce((sum, state) => sum + (state.population ?? 0), 0);
}

/**
 * National GDP-per-capita for the cost-scale ramp. Loads the country's national
 * budget GDP and total population. Returns undefined if either is unavailable.
 */
export async function resolveNationalGdpPerCapita(
  db: Db,
  countryId: CountryId
): Promise<number | undefined> {
  const budget = await db
    .collection<FederalBudget>("federalBudget")
    .findOne({ _id: getNationalBudgetId(countryId) });
  if (!budget?.gdp) return undefined;
  const population = await getCountryPopulation(db, countryId);
  return population > 0 ? budget.gdp / population : undefined;
}

/**
 * Live national median income (local currency) for the era perCapita cost
 * base — read from the country's national stateMetrics doc (population-
 * weighted by computeNationalMetrics each turn). Undefined when the doc or
 * value is unavailable; resolveEraSpendingCost then falls back to its
 * share-of-GDP form (never the real-world era anchor).
 */
export async function resolveNationalMedianIncome(
  db: Db,
  countryId: CountryId
): Promise<number | undefined> {
  const nationalDocId = getNationalDocId(countryId);
  if (!nationalDocId) return undefined;
  const doc = await db
    .collection<StateMetrics>("macroMetrics")
    .findOne({ _id: nationalDocId }, { projection: { "economic.medianIncome.value": 1 } });
  const value = doc?.economic?.medianIncome?.value;
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined;
}

export async function calculateFederalSpending(
  db: Db,
  budget: FederalBudget,
  debtInterest: number,
  // Optional pre-fetched era context, hoisted by refreshNationalBudgetRevenue
  // so the world-constant gameState read happens once per turn instead of once
  // per budget. Omitted => resolved here (single-budget callers).
  hoistedEraContext?: EraContext
): Promise<FederalBudget["spending"]> {
  const budgetCountryId = (budget.countryId ||
    (budget._id === COUNTRY_CONFIGS.UK.id
      ? COUNTRY_CONFIGS.UK.id
      : COUNTRY_CONFIGS.US.id)) as CountryId;
  const nationalQuery: Record<string, unknown> = {
    scope: "national",
    ...nationalLawCountryQuery(budgetCountryId),
    repealedAt: { $exists: false },
  };
  // These five reads are independent of one another — one round instead of a
  // serial chain.
  const [rawLaws, population, nationalMedianIncome, eraContext, v2Base, gameConfig] =
    await Promise.all([
      db.collection<EnactedLaw>("enactedLaws").find(nationalQuery).toArray(),
      getCountryPopulation(db, budgetCountryId),
      resolveNationalMedianIncome(db, budgetCountryId),
      // Spec B: era cost forms apply when the flag is on (year non-null); null ⇒ legacy.
      hoistedEraContext ? Promise.resolve(hoistedEraContext) : getEraContext(db),
      // Political-legislation v2 (spec §5.1): countries with new-generation laws
      // price them on the REGIONAL-ROLLUP base, not the budget-seed gdp. One read
      // per sync; other countries skip it entirely.
      budgetCountryId in COST_INCOME_ANCHORS
        ? countryFiscalBase(db, budgetCountryId)
        : Promise.resolve(undefined),
      // Plan-economy allocations lapse rather than disburse (see the transfer
      // block below); joins this batch so the gate costs no extra round trip.
      db
        .collection<{ _id: string; commandEconomyEnabled?: boolean }>("gameConfig")
        .findOne({ _id: "default" }, { projection: { commandEconomyEnabled: 1 } }),
    ]);
  const enactedLaws = keepLatestActiveLawPerType(rawLaws);
  const nationalGdpPerCapita = population > 0 ? budget.gdp / population : undefined;
  const { year: eraYear, incomeBandIndexByCountry } = eraContext;
  const incomeBandIndex = incomeBandIndexByCountry?.[budgetCountryId] ?? null;
  const byCategory: Record<string, number> = {};
  let stateGrants = 0;

  for (const law of enactedLaws) {
    // Phantom-line gate (Spec B): an era-inactive law contributes no spending line
    // while the flag is on. Null year (flag off) ⇒ every law counts, legacy.
    if (!isLegislationTypeActive(law.legislationTypeId, eraYear)) continue;
    const cost = calculateEnactedLawAnnualCost(law, {
      budgetCapacity: budget.revenue.total,
      gdp: budget.gdp,
      population,
      countryId: budgetCountryId,
      nationalGdpPerCapita,
      nationalMedianIncome,
      year: eraYear,
      v2Base,
      incomeBandIndex,
    });

    if (!Number.isFinite(cost) || cost === 0) continue;

    if (law.isGrant) {
      stateGrants += cost;
    } else {
      const category = law.budgetCategory || "other";
      byCategory[category] = (byCategory[category] || 0) + cost;
    }
  }

  // Fallback: if no enacted spending laws exist, use seeded baselines
  // (incompletely-seeded countries like CN, BR, IE).
  if (Object.keys(byCategory).length === 0 && stateGrants === 0) {
    if (budget.baselineSpendingByCategory) {
      for (const [category, amount] of Object.entries(budget.baselineSpendingByCategory)) {
        byCategory[category] = (byCategory[category] || 0) + amount;
      }
    }
    if (budget.baselineStateGrants) {
      stateGrants = budget.baselineStateGrants;
    }
  }

  // Config-derived central transfer pools (CN/DE/UK) are credited to regions in
  // the regional-budget processors but — unlike JP's isGrant funding law — have
  // no enacted national law to book them as spending. Sum the actual distributed
  // grants from regionalBudgets so the national budget reflects the transfer as
  // an expense and stays consistent with the Finance Minister's per-region split.
  // Scope by CURRENT state ids (not countryId) so stale orphan regionalBudgets
  // from prior region-id schemes — e.g. CN's pre-rename NORTHEAST/EAST/… docs —
  // are excluded and the pool is not double-counted. Mirrors federalBudgetDetail.
  const transferGrantField = CONFIG_DERIVED_TRANSFER_FIELD[budgetCountryId];
  if (transferGrantField) {
    const stateIds = (
      await db
        .collection<State>("states")
        .find({ countryId: budgetCountryId }, { projection: { _id: 1 } })
        .toArray()
    ).map((s) => s._id);
    const regionalBudgets = await db
      .collection<RegionalBudget>("regionalBudgets")
      .find({ _id: { $in: stateIds } })
      .toArray();
    // A PLANNED economy allocates rather than disburses: an allocation a
    // republic never draws down lapses at the end of the year, so the centre is
    // charged for what was actually spent, capped at the allocation. Live RU
    // hands its republics ₽44.00B and they spend ₽24.34B — the ₽19.66B
    // remainder banks into a regional surplus that is never accumulated
    // anywhere, so booking it would charge the union for programmes that do not
    // exist. A MARKET economy's transfer is genuinely disbursed whether the
    // region spends it or not, so it still books in full.
    const lapses = isPlannedEconomy(
      budgetCountryId,
      eraYear,
      gameConfig?.commandEconomyEnabled === true
    );
    stateGrants += regionalBudgets.reduce((sum, rb) => {
      const allocated = rb[transferGrantField] ?? 0;
      return sum + (lapses ? Math.min(allocated, rb.enactedBillCosts ?? 0) : allocated);
    }, 0);
  }

  return normalizeFederalSpending({
    byCategory,
    stateGrants,
    debtInterest,
    total: 0,
  });
}

export async function calculateStateSpending(
  db: Db,
  stateId: string,
  countryId: CountryId,
  budget: StateBudget
): Promise<StateBudget["spending"]> {
  const enactedLaws = await db
    .collection<EnactedLaw>("enactedLaws")
    .find({ scope: "state", stateId, repealedAt: { $exists: false } })
    .toArray();

  const state = await db.collection<State>("states").findOne({ _id: stateId, countryId });
  // The cost-scale ramp is a national-era factor, so it uses the country's national
  // GDP-per-capita even for state laws (the per-capita cost itself still uses the
  // state population below).
  const nationalGdpPerCapita = await resolveNationalGdpPerCapita(db, countryId);
  // Income levels are a national-era factor (like the cost-scale ramp); the
  // per-capita cost itself still uses the state population in the context.
  const nationalMedianIncome = await resolveNationalMedianIncome(db, countryId);
  const { year: eraYear, incomeBandIndexByCountry } = await getEraContext(db);
  // Political-legislation v2: regional enactments price on the region's own base.
  const v2Base = countryId in COST_INCOME_ANCHORS ? await regionFiscalBase(db, stateId) : undefined;
  const incomeBandIndex = incomeBandIndexByCountry?.[countryId] ?? null;
  const byCategory: Record<string, number> = {};

  for (const law of enactedLaws) {
    // Phantom-line gate (Spec B): skip era-inactive laws while the flag is on.
    if (!isLegislationTypeActive(law.legislationTypeId, eraYear)) continue;
    const cost = calculateEnactedLawAnnualCost(law, {
      budgetCapacity: budget.revenue.total,
      gdp: budget.stateGdp,
      population: state?.population ?? 0,
      countryId,
      nationalGdpPerCapita,
      nationalMedianIncome,
      year: eraYear,
      v2Base,
      incomeBandIndex,
    });
    const category = law.budgetCategory || "other";
    byCategory[category] = (byCategory[category] || 0) + cost;
  }

  return normalizeStateSpending({
    byCategory,
    // Read the persisted state-prospecting spend back so it survives this
    // rebuild-from-laws recompute (same treatment as revenue.resourceRoyalties).
    resourceProspecting: budget.spending?.resourceProspecting ?? 0,
    total: 0,
  });
}

/**
 * Recompute federalBudget.spending from enacted laws and persist it.
 * Called after a bill is enacted so the budget reflects the new law immediately
 * rather than waiting for the fiscal-year processor or the heal route.
 */
export async function syncFederalBudgetSpending(db: Db, countryId: CountryId): Promise<void> {
  const budgetId = getNationalBudgetId(countryId);
  const budget = await db.collection<FederalBudget>("federalBudget").findOne({ _id: budgetId });
  if (!budget) return;

  const debtInterest = (budget.debt?.principal ?? 0) * (budget.debt?.interestRate ?? 0);
  const spending = await calculateFederalSpending(db, budget, debtInterest);
  if (spending.total === 0) return;

  const surplus = (budget.revenue?.total ?? 0) - spending.total;
  await db
    .collection<FederalBudget>("federalBudget")
    .updateOne({ _id: budgetId }, { $set: { spending, surplus, updatedAt: new Date() } });
}

export async function getEnactedLawsSpendingTotal(
  db: Db,
  scope: "national" | "state",
  stateId?: string
): Promise<number> {
  const query: Record<string, unknown> = {
    scope,
    repealedAt: { $exists: false },
  };
  if (stateId) query.stateId = stateId;

  const laws = keepLatestActiveLawPerType(
    await db.collection<EnactedLaw>("enactedLaws").find(query).toArray()
  );
  return laws.reduce((sum, law) => sum + law.budgetCost, 0);
}
