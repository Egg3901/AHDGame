import type { Db } from "mongodb";
import type { Corporation, CorporateSector, FederalRevenue, StateMetrics } from "@/lib/db/types";
import type { FederalBudget } from "@/lib/db/types/budget";
import type { CountryId } from "@/lib/constants/countries";
import { type CurrencyCode } from "@/lib/constants/currencies";
import {
  anchorToCorpCapital,
  fxRateForCorpFromMap,
  loadFxRatesByCurrency,
  resolveCorpLiquidCurrencyCode,
  resolveSectorHostCurrencyCode,
  fxRateForSectorHostFromMap,
} from "@/lib/currency/corporationCapital";
import { readCorpEconomicAnchor } from "@/lib/currency/corpEconomyFields";
import { computeSoeEfficiencyPenalty } from "@/lib/nationalization/soeEfficiency";
import { NATCORP_RD_FULL_FUND_REVENUE_FRACTION } from "@/lib/nationalization/constants";
import { isStateOwned } from "@/lib/nationalization/nationalCorporation";
import {
  readStateOwnershipConcentration,
  sociMultiplier,
} from "@/lib/nationalization/concentration";
import { resolveSectorMandate } from "@/lib/nationalization/soeMandates";
import { cappedRemittanceLocal, uncappedRemittanceLocal } from "@/lib/nationalization/ceoFinance";
import { loadSoeGovernanceInputs } from "@/lib/nationalization/soeGovernanceInputs";
import { TURNS_PER_DAY, TURNS_PER_YEAR } from "@/lib/constants/turnTime";
import { IDLE_UPKEEP_FRACTION, MOTHBALL_UPKEEP_FRACTION } from "@/lib/constants/capacityEconomy";
import { sectorConstructionInProgressAnchor } from "@/lib/corporations/sectorProfitBasis";
import { getMarketSystemModeForDb, marketAtLeast } from "@/lib/market/featureFlag";
import type { MarketSystemMode } from "@/lib/market/featureFlag";
import { MARKET_REALIZATION_RAMP_TURNS } from "@/lib/market/capital";
import type { GameConfig } from "@/lib/db/types";
import type { GameState } from "@/lib/db/types/gameState";
import { soeCapacityReplacementCostAnchor } from "@/lib/economy/soe";

/**
 * Safety ceiling for a SYNTHETIC *scaled* national corp's per-turn budget impact,
 * as a share of GDP. The UK/JP healthcare stand-in corps carry a large
 * `budgetRevenueMultiplier` (≈33k) to bridge game-scale operating income to real
 * budget revenue; that product drifts unbounded as the corp accumulates sectors and
 * its per-sector revenue compounds (the live UK line reached ~92% of GDP, a surplus
 * larger than the whole economy). Clamp each scaled corp's contribution to this
 * fraction of GDP so the line stays sane and scales gently with the economy.
 * Applies ONLY to corps with `budgetRevenueMultiplier > 1`; genuine real-scale SOEs
 * (multiplier 1) are unaffected. Tunable calibration knob.
 */
export const MAX_SCALED_ENTERPRISE_REVENUE_GDP_SHARE = 0.03;

/**
 * P3b — SOE remittance under the plants tier: amortized capex.
 *
 * Below plants an SOE's operating income deducted `currentGrowthCost` every
 * turn: the growth slider was a continuous capital charge, so a state
 * enterprise that was expanding remitted less. Under plants the growth slider
 * no longer buys anything (see `sectorProfitBasis`) so that deduction is a
 * phantom charge — but simply deleting it hands every SOE a permanent, one-off
 * WINDFALL on flip day: the capital charge vanishes and remittances step up,
 * even though the enterprise is now buying capacity with real, lumpier build
 * orders.
 *
 * The honest replacement is to spread the capitalized build spend that IS on
 * the books (`constructionInProgressAnchor`) across the life of the asset:
 *
 *     capexDeductionPerTurn = outstandingCIP × CAPEX_AMORTIZATION_PER_TURN
 *
 * The rate is 1 / (2 × TURNS_PER_YEAR) — a two-game-year straight line. It is a
 * REMITTANCE-SIDE accounting charge only: it does not move cash (the corp
 * already paid the build), it stops the treasury from sweeping out money the
 * enterprise has committed to construction. A sector with nothing in flight
 * deducts nothing, so a steady-state SOE is unaffected either way.
 *
 * Tunable calibration knob.
 */
export const CAPEX_AMORTIZATION_PER_TURN = 1 / (2 * TURNS_PER_YEAR);

/**
 * Governor ramp weight for the plants IDLE-UPKEEP charge: 0 on the flip turn,
 * rising linearly to 1 over `rampTurns`.
 *
 * SINGLE SOURCE OF TRUTH. The turn processor charges idle upkeep through the
 * same ramp (`plantsRampLambda` in sectorTurn) so the flip turn is a numeric
 * no-op. The remittance mirror below used to apply the charge at FULL strength
 * from the flip turn, so SOE remittances stepped down discontinuously on flip
 * day even though the turn processor charged nothing — a duplicated formula
 * that drifted from the one it was mirroring. Anything that mirrors the idle
 * charge must call THIS, never re-derive it.
 *
 * A sector with no `plantsStartTurn` (or a caller that cannot supply the
 * current turn) gets 1 — matching the turn processor's "no anchor ⇒ no ramp",
 * i.e. a sector that has been under plants since before the anchor existed is
 * already past its ramp.
 */
export function plantsUpkeepRampLambda(
  plantsStartTurn: number | null | undefined,
  currentTurn: number | null | undefined,
  rampTurns: number
): number {
  if (plantsStartTurn == null || currentTurn == null || rampTurns <= 0) return 1;
  return Math.max(0, Math.min(1, (currentTurn - plantsStartTurn) / rampTurns));
}

/**
 * Everything the budget pass needs to mirror the plants tier, resolved ONCE per
 * turn instead of once per country. `getMarketSystemModeForDb` used to be called
 * inside each of the two per-country entry points below, which is one extra DB
 * round trip per country per turn (30-50 of them, every turn, for a value that
 * cannot change mid-pass).
 */
export interface PlantsBudgetContext {
  plantsEnabled: boolean;
  /** `gameState.currentTurn`; null ⇒ no ramp (λ = 1). */
  currentTurn: number | null;
  /** `gameConfig.marketGovernorRampTurns`, defaulted like `buildMarketContext`. */
  rampTurns: number;
}

/**
 * Resolve {@link PlantsBudgetContext} from the DB. Callers that already hold the
 * market mode should hoist this to the top of their per-country loop; the
 * per-country functions below fall back to calling it themselves so existing
 * callers and tests keep working unchanged.
 */
export async function loadPlantsBudgetContext(
  db: Db,
  mode?: MarketSystemMode
): Promise<PlantsBudgetContext> {
  const resolvedMode = mode ?? (await getMarketSystemModeForDb(db));
  const plantsEnabled = marketAtLeast(resolvedMode, "plants");
  // Below plants nothing reads the ramp, so skip both reads entirely.
  if (!plantsEnabled) {
    return { plantsEnabled: false, currentTurn: null, rampTurns: MARKET_REALIZATION_RAMP_TURNS };
  }
  const [state, config] = await Promise.all([
    db
      .collection<GameState>("gameState")
      .findOne({ _id: "current" }, { projection: { currentTurn: 1 } }),
    db
      .collection<GameConfig>("gameConfig")
      .findOne({ _id: "default" }, { projection: { marketGovernorRampTurns: 1 } }),
  ]);
  const rampTurns =
    typeof config?.marketGovernorRampTurns === "number" && config.marketGovernorRampTurns >= 1
      ? config.marketGovernorRampTurns
      : MARKET_REALIZATION_RAMP_TURNS;
  return {
    plantsEnabled: true,
    currentTurn: typeof state?.currentTurn === "number" ? state.currentTurn : null,
    rampTurns,
  };
}

/**
 * Read a country's GDP (country-local) from its federalBudget doc. Used only to size
 * the {@link MAX_SCALED_ENTERPRISE_REVENUE_GDP_SHARE} ceiling for scaled synthetic
 * corps. Returns 0 when unavailable, in which case the caller skips the clamp.
 */
async function readCountryGdp(db: Db, countryId: CountryId): Promise<number> {
  const budget = await db
    .collection<FederalBudget>("federalBudget")
    .findOne({ countryId }, { projection: { gdp: 1 } });
  return typeof budget?.gdp === "number" && budget.gdp > 0 ? budget.gdp : 0;
}

/**
 * Returns estimated operating income in ₳. Per-sector revenue/growth cost are
 * stored in the sector's HOST-state currency (the market it operates in); corp-
 * level overhead (marketingBudget / logisticsBudget / ceoSalary) is stored in
 * the corp's home currency. We normalize each via its own FX rate before the
 * arithmetic. Sectors/corps with no resolvable currency passthrough at rate=1.0.
 */
export function estimateNationalizedOperatingIncome(
  corporation: Corporation,
  sectors: CorporateSector[],
  fxByCurrency: ReadonlyMap<CurrencyCode, number>,
  stateMetricsById: ReadonlyMap<string, StateMetrics>,
  concentrationMultiplier: number = 1,
  /**
   * Under the plants tier the per-sector capital charge switches from the (now
   * vestigial) growth cost to amortized capex + real idle upkeep — see
   * {@link CAPEX_AMORTIZATION_PER_TURN}. Defaults false, so every non-plants
   * caller is byte-identical.
   */
  plantsEnabled: boolean = false,
  /**
   * Flip-identity ramp inputs for the idle-upkeep mirror (see
   * {@link plantsUpkeepRampLambda}). Omitted ⇒ λ = 1, i.e. the charge at full
   * strength, which is what every pre-existing caller already got.
   */
  plantsRamp?: { currentTurn: number | null; rampTurns: number }
): number {
  const code = resolveCorpLiquidCurrencyCode(corporation);
  const rate = fxRateForCorpFromMap(corporation, fxByCurrency);

  let sectorIncome = 0;
  let totalRevenueAnchor = 0;
  for (const sector of sectors) {
    // Sector fields are in the sector's host-state currency, not the corp's.
    const sectorCode = resolveSectorHostCurrencyCode(sector, corporation);
    const sectorRate = fxRateForSectorHostFromMap(sector, corporation, fxByCurrency);
    const revenueAnchor = readCorpEconomicAnchor(sector.revenue, sectorCode, sectorRate);
    totalRevenueAnchor += revenueAnchor;
    const growthCostAnchor = readCorpEconomicAnchor(
      sector.currentGrowthCost,
      sectorCode,
      sectorRate
    );
    // Dynamic SOE efficiency (spec §11.3) — same shared function as the turn math
    // and the corp-detail display, so the budget estimate stays aligned with the
    // operating income the turn actually produces.
    const metrics = stateMetricsById.get(sector.stateId) ?? null;
    const mandate = resolveSectorMandate(corporation, sector);
    const soePenalty = isStateOwned(corporation)
      ? computeSoeEfficiencyPenalty({
          corruptionIndex: metrics?.governance?.corruptionIndex?.value ?? null,
          governmentTransparency: metrics?.governance?.governmentTransparency?.value ?? null,
          priceControlled: mandate.priceControlled === true,
          employmentGuaranteed: mandate.employmentGuaranteed === true,
          concentrationMultiplier,
        })
      : 0;
    const effectiveMargin = Math.max(0, Math.min(100, sector.profitMargin + soePenalty));
    // MOTHBALLED plants earn nothing (ticket #1072). `sector.revenue` is the
    // plants-tier nameplate (capacity x mix price) and mothballing does not
    // touch it, so without this the treasury kept booking a cold plant's full
    // nameplate at its seeded margin as budget revenue and as remittable
    // profit. The engine is unconditional in the other direction: a mothballed
    // sector "earns exactly 0" (`marketHourlyRevenue`, sectorTurn D12).
    const earningRevenueAnchor = plantsEnabled && sector.mothballed === true ? 0 : revenueAnchor;
    const maintenance = earningRevenueAnchor * (1 - effectiveMargin / 100);
    // Plants: the growth charge is vestigial, but dropping it outright is a
    // one-off remittance windfall. Replace it with the two real capital costs
    // the plants tier creates — amortized construction-in-progress and the
    // upkeep on idle plants — both expressed DAILY to match `revenueAnchor`
    // (the CIP rate is per-TURN, hence × TURNS_PER_DAY).
    //
    // Idle upkeep mirrors the turn processor's additive charge
    // (`plantsUpkeepCost` in sectorTurn): under plants `revenue` IS
    // capacity × mixPrice, so `revenue × (1 − utilization)` is exactly the
    // nominal value of the idle units, and the same (1 − margin) ×
    // IDLE_UPKEEP_FRACTION rate applies.
    //
    // PLANT utilization is `capitalUtilization` (produced ÷ plant capacity,
    // written for every sector under plants), NOT `capacityUtilization` —
    // that field is EXTRACTION GEOLOGY utilization and is only ever written
    // for sectorType === "extraction", so reading it here made this charge
    // exactly 0 for every non-extraction SOE sector. A sector with no
    // persisted value yet is treated as fully utilized (charge 0) rather than
    // fully idle — the pre-flip default must not invent a cost.
    //
    // FLIP IDENTITY: the charge is faded in over the SAME governor ramp the
    // turn processor uses (λ = 0 on the flip turn). Without it the remittance
    // stepped down on flip day against a turn processor that was still
    // charging nothing.
    const upkeepLambda = plantsEnabled
      ? plantsUpkeepRampLambda(
          sector.plantsStartTurn,
          plantsRamp?.currentTurn ?? null,
          plantsRamp?.rampTurns ?? 0
        )
      : 0;
    // OWNER-idle share, not total idle share — mirrors `ownerIdleUnits` in the
    // turn processor. Capacity idled by input throughput is not an over-build,
    // and on the live world every sector sat at the governor's throughput floor,
    // so reading total idleness billed the whole world for a shortage. The
    // persisted `throughputFactor` is the involuntary leg this estimate can see;
    // the turn also divides out disaster/strike/hard-min legs, so this is a
    // slight OVER-estimate of the charge (a conservative remittance), never an
    // under-estimate.
    const plantsUtilization = sector.capitalUtilization ?? 1;
    const plantsInvoluntary = sector.throughputFactor ?? 1;
    const ownerIdleShare =
      plantsInvoluntary > 0
        ? Math.max(0, 1 - Math.min(1, plantsUtilization / plantsInvoluntary))
        : 0;
    // Held basis, not the live margin — see `idleUpkeepUnitPrice`. Pricing a
    // fixed upkeep off a falling margin made the charge grow as the SOE got
    // worse, which fed straight back into the state's remittance estimate.
    const upkeepBasis =
      typeof sector.plantsUpkeepMarginBasisAnchor === "number" &&
      Number.isFinite(sector.plantsUpkeepMarginBasisAnchor)
        ? Math.max(0, Math.min(1, sector.plantsUpkeepMarginBasisAnchor))
        : Math.max(0, 1 - effectiveMargin / 100);
    // A mothballed plant is COLD, not idle: it pays MOTHBALL_UPKEEP_FRACTION on
    // its whole capacity, which is the charge `plantsUpkeepCost` applies in the
    // turn. Charging it the idle rate on the idle share instead both overstated
    // the cost and, paired with the nameplate revenue above, let the sign of
    // the whole line depend on the sector's seeded margin.
    const upkeepCharge =
      sector.mothballed === true
        ? revenueAnchor * upkeepBasis * MOTHBALL_UPKEEP_FRACTION * upkeepLambda
        : revenueAnchor * ownerIdleShare * upkeepBasis * IDLE_UPKEEP_FRACTION * upkeepLambda;
    const plantsCapitalCharge = plantsEnabled
      ? sectorConstructionInProgressAnchor(sector) * CAPEX_AMORTIZATION_PER_TURN * TURNS_PER_DAY +
        upkeepCharge
      : 0;
    const operatingProfit =
      earningRevenueAnchor - maintenance - (plantsEnabled ? plantsCapitalCharge : growthCostAnchor);
    sectorIncome += operatingProfit;
  }

  const marketingAnchor = readCorpEconomicAnchor(corporation.marketingBudget ?? 0, code, rate);
  const logisticsAnchor = readCorpEconomicAnchor(corporation.logisticsBudget ?? 0, code, rate);
  const ceoSalaryAnchor = readCorpEconomicAnchor(corporation.ceoSalary ?? 0, code, rate);

  // NatCorp R&D (modernization) is an operating cost, charged here so the same
  // spend the turn processor applies to `rdScore` (see buildRdModernizationOps)
  // lands on BOTH the treasury remittance and the budget's State Enterprises
  // line — the treasury funds R&D by remitting less. Capped at the corp's own
  // revenue (× the full-fund fraction), identical to the turn math. SOE-only:
  // private corps model R&D through the separate `rdBudget` field elsewhere.
  const rdSpendAnchor = isStateOwned(corporation)
    ? Math.min(
        readCorpEconomicAnchor(corporation.rdBudgetPerTurn ?? 0, code, rate),
        totalRevenueAnchor * NATCORP_RD_FULL_FUND_REVENUE_FRACTION
      )
    : 0;

  return sectorIncome - marketingAnchor - logisticsAnchor - ceoSalaryAnchor - rdSpendAnchor;
}

export async function calculateCountryOwnedBudgetRevenue(
  db: Db,
  countryId: CountryId,
  /**
   * Hoisted by the budget-turn caller (`refreshNationalBudgetRevenue`) so the
   * market-mode / ramp reads happen once per turn, not once per country.
   * Omitted ⇒ resolved here, so one-off callers and tests are unchanged.
   */
  plantsContext?: PlantsBudgetContext,
  /**
   * World-constant FX map, hoisted the same way as plantsContext by the
   * per-turn budget refresh. Omitted ⇒ loaded here.
   */
  hoistedFxByCurrency?: ReadonlyMap<CurrencyCode, number>
): Promise<Partial<Record<keyof FederalRevenue, number>>> {
  const corporations = await db
    .collection<Corporation>("corporations")
    .find({ countryOwnerId: countryId })
    .toArray();

  if (corporations.length === 0) {
    return {};
  }

  // SOCI escalation for this country's SOEs (overreach term) — read once.
  const soeConcentrationMultiplier = sociMultiplier(
    await readStateOwnershipConcentration(db, countryId)
  );

  const corporationIds = corporations.map((corporation) => corporation._id);
  const [allSectors, fxByCurrency] = await Promise.all([
    db
      .collection<CorporateSector>("corporateSectors")
      .find(
        { corporationId: { $in: corporationIds } },
        { projection: { buildQueue: 0, plantsPnl: 0, soldByCommodity: 0 } }
      )
      .toArray(),
    hoistedFxByCurrency ? Promise.resolve(hoistedFxByCurrency) : loadFxRatesByCurrency(db),
  ]);

  // Per-state metrics drive the dynamic SOE efficiency penalty (spec §11.3), so
  // this estimate matches the per-sector margin the turn actually applies.
  const stateIds = Array.from(new Set(allSectors.map((s) => s.stateId)));
  const stateMetricsById = await loadSoeGovernanceInputs(db, stateIds);

  const sectorsByCorporationId = new Map<string, CorporateSector[]>();
  for (const sector of allSectors) {
    const key = sector.corporationId.toString();
    const sectors = sectorsByCorporationId.get(key) ?? [];
    sectors.push(sector);
    sectorsByCorporationId.set(key, sectors);
  }

  // A scaled synthetic corp (multiplier > 1) needs a GDP ceiling; read GDP once iff
  // any such corp exists so real-scale-only economies pay no extra query.
  const hasScaledCorp = corporations.some((c) => (c.budgetRevenueMultiplier ?? 1) > 1);
  const gdp = hasScaledCorp ? await readCountryGdp(db, countryId) : 0;
  const plants = plantsContext ?? (await loadPlantsBudgetContext(db));

  // estimateNationalizedOperatingIncome normalizes each natcorp's revenue to ₳
  // via the corp's FX rate; the remittance is computed in the corp's local currency,
  // which for a NatCorp IS the country currency — so the returned lines are
  // country-local, matching the federalBudget.revenue fields they credit.
  const revenueLines: Partial<Record<keyof FederalRevenue, number>> = {};
  for (const corporation of corporations) {
    const revenueKey = corporation.budgetRevenueKey ?? "other";
    const multiplier = corporation.budgetRevenueMultiplier ?? 1;
    const operatingIncome = estimateNationalizedOperatingIncome(
      corporation,
      sectorsByCorporationId.get(corporation._id.toString()) ?? [],
      fxByCurrency,
      stateMetricsById,
      soeConcentrationMultiplier,
      plants.plantsEnabled,
      plants
    );
    // Only the remitted share of profit is budget revenue — the CEO-retained share
    // stays in the corp (spec P6g §5.1). liquidCapital is corp-local; for a NatCorp
    // the corp's currency is the country currency, so the contribution is country-local.
    const code = resolveCorpLiquidCurrencyCode(corporation);
    const corpRate = fxRateForCorpFromMap(corporation, fxByCurrency);
    const incomeLocal = anchorToCorpCapital(operatingIncome, code, corpRate);
    const budgetRevenueContributionLocal = scaledBudgetContributionLocal(
      incomeLocal,
      corporation,
      multiplier,
      gdp
    );

    revenueLines[revenueKey] = Math.round(
      (revenueLines[revenueKey] ?? 0) + budgetRevenueContributionLocal
    );
  }

  return revenueLines;
}

/**
 * Per-corp budget revenue contribution (country-local), branching on whether the corp
 * is a scaled synthetic stand-in or a real-scale SOE.
 *
 * - Real-scale SOE (`multiplier <= 1`): capped at on-hand `liquidCapital` — the budget
 *   line equals what is ACTUALLY remitted, so a cash-poor loss-maker contributes 0
 *   (no phantom revenue), exactly as before.
 * - Scaled synthetic corp (`multiplier > 1`): the line is a steady-state ESTIMATE
 *   (`uncappedRemittanceLocal × multiplier`) decoupled from the corp's volatile
 *   game-scale cash so it stops blinking £0↔huge, then clamped to a share of GDP so it
 *   can't drift larger than the economy. The actual cash move stays cash-capped in
 *   `processSoeRemittance`.
 */
function scaledBudgetContributionLocal(
  incomeLocal: number,
  corporation: Corporation,
  multiplier: number,
  gdp: number
): number {
  if (multiplier <= 1) {
    const remittedLocal = cappedRemittanceLocal(
      incomeLocal,
      corporation.profitRetentionPercent,
      corporation.liquidCapital
    );
    return remittedLocal * multiplier;
  }
  const remittedLocal = uncappedRemittanceLocal(incomeLocal, corporation.profitRetentionPercent);
  const scaled = remittedLocal * multiplier;
  if (gdp > 0) {
    return Math.min(scaled, gdp * MAX_SCALED_ENTERPRISE_REVENUE_GDP_SHARE);
  }
  return scaled;
}

/**
 * Signed per-turn budget impact of a country's National Corporations, in
 * country-local currency: remitted profit (positive — a revenue line) net of
 * treasury-backed operating losses (negative — an expenditure line). Drives the
 * budget page's State Enterprises line. Positive ⇒ Revenue, negative ⇒ Expenditure.
 */
export async function estimateCountryOwnedBudgetNetLocal(
  db: Db,
  countryId: CountryId,
  /** Same hoisting contract as {@link calculateCountryOwnedBudgetRevenue}. */
  plantsContext?: PlantsBudgetContext
): Promise<number> {
  const corporations = await db
    .collection<Corporation>("corporations")
    .find({ countryOwnerId: countryId })
    .toArray();
  if (corporations.length === 0) return 0;

  const soeConcentrationMultiplier = sociMultiplier(
    await readStateOwnershipConcentration(db, countryId)
  );

  const corporationIds = corporations.map((c) => c._id);
  const [allSectors, fxByCurrency] = await Promise.all([
    db
      .collection<CorporateSector>("corporateSectors")
      .find(
        { corporationId: { $in: corporationIds } },
        { projection: { buildQueue: 0, plantsPnl: 0, soldByCommodity: 0 } }
      )
      .toArray(),
    loadFxRatesByCurrency(db),
  ]);

  const stateIds = Array.from(new Set(allSectors.map((s) => s.stateId)));
  const stateMetricsById = await loadSoeGovernanceInputs(db, stateIds);

  const sectorsByCorporationId = new Map<string, CorporateSector[]>();
  for (const s of allSectors) {
    const k = s.corporationId.toString();
    sectorsByCorporationId.set(k, [...(sectorsByCorporationId.get(k) ?? []), s]);
  }

  const hasScaledCorp = corporations.some((c) => (c.budgetRevenueMultiplier ?? 1) > 1);
  const gdp = hasScaledCorp ? await readCountryGdp(db, countryId) : 0;
  const plants = plantsContext ?? (await loadPlantsBudgetContext(db));

  // Game year, for era-pricing the state capex grant below. Only read when the
  // grant can exist (plants tier), so nothing else pays for it.
  const grantYear = plants.plantsEnabled
    ? ((
        await db
          .collection<GameState>("gameState")
          .findOne({ _id: "current" }, { projection: { currentYear: 1 } })
      )?.currentYear ?? null)
    : null;
  // Dynamic import: a static one closes the cycle budget/revenue →
  // publicEnterpriseRevenue → gdpAnchorRate → countryReadinessContract →
  // budgets → budget/revenue, and budgets.ts runs seed construction at module
  // init — the cycle leaves its helpers undefined mid-evaluation.
  const grantUnitScale = plants.plantsEnabled
    ? await (await import("@/lib/currency/gdpAnchorRate")).loadWorldEraUnitScale(db)
    : 1;

  let netLocal = 0;
  for (const corporation of corporations) {
    // STATE CAPEX GRANT — the budgeted expenditure line for the capacity the
    // treasury buys back on this enterprise's behalf each turn
    // (`applyStateCapexGrants`). Command SOEs are excluded here for the same
    // reason they are excluded there: their capacity is funded by Gosbank
    // directed credit, which is a monetary operation, not a budget line.
    if (plants.plantsEnabled && !corporation.soe) {
      const grantAnchor = soeCapacityReplacementCostAnchor(
        sectorsByCorporationId.get(corporation._id.toString()) ?? [],
        grantYear,
        grantUnitScale
      );
      if (grantAnchor > 0) {
        const grantCode = resolveCorpLiquidCurrencyCode(corporation);
        const grantRate = fxRateForCorpFromMap(corporation, fxByCurrency);
        netLocal -= anchorToCorpCapital(grantAnchor, grantCode, grantRate);
      }
    }
    const operatingIncome = estimateNationalizedOperatingIncome(
      corporation,
      sectorsByCorporationId.get(corporation._id.toString()) ?? [],
      fxByCurrency,
      stateMetricsById,
      soeConcentrationMultiplier,
      plants.plantsEnabled,
      plants
    );
    const multiplier = corporation.budgetRevenueMultiplier ?? 1;
    const code = resolveCorpLiquidCurrencyCode(corporation);
    const corpRate = fxRateForCorpFromMap(corporation, fxByCurrency);
    const incomeLocal = anchorToCorpCapital(operatingIncome, code, corpRate);
    if (operatingIncome >= 0) {
      // Profit: the remitted share is a revenue line (see scaledBudgetContributionLocal —
      // real-scale SOEs cash-capped, scaled synthetic corps a GDP-clamped estimate).
      netLocal += scaledBudgetContributionLocal(incomeLocal, corporation, multiplier, gdp);
    } else {
      // Loss: the treasury backs the whole shortfall. For a scaled synthetic corp the
      // multiplied loss is clamped to the same GDP share so a downturn can't drain a
      // surplus-larger-than-the-economy in one turn.
      const scaledLoss = incomeLocal * multiplier;
      netLocal +=
        multiplier > 1 && gdp > 0
          ? Math.max(scaledLoss, -gdp * MAX_SCALED_ENTERPRISE_REVENUE_GDP_SHARE)
          : scaledLoss;
    }
  }

  return Math.round(netLocal);
}
