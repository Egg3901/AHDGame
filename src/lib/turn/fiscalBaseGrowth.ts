import { getDb } from "@/lib/mongodb";
import type { FederalBudget, StateBudget, EconomicGrowthFactors } from "@/lib/db/types/budget";
import type { StateMetrics } from "@/lib/db/types/stateMetrics";
import type { State } from "@/lib/db/types/state";
import type { CountryId } from "@/lib/constants/countries";
import { getNationalDocId, NATIONAL_SCOPE_IDS } from "@/lib/constants/nationalScope";
import {
  applyPerTurnGrowthToFederalBases,
  applyPerTurnGrowthToStateBases,
  calculateFederalRevenue,
  computeTaxBaseGdpShareBaseline,
  normalizeFederalTaxRates,
  type TaxBaseGravityContext,
} from "@/lib/budget/revenue";

/**
 * Per-turn fiscal base growth (the dynamic wage/trade application). The metric
 * engine recomputes `economic.wageGrowth`/`tradeGrowth`/`gdpGrowth` every turn as
 * ANNUAL display rates; this phase applies a single `1/TURNS_PER_YEAR` slice of
 * them to the tax bases each turn (mirroring how the engine already compounds
 * `state.gdp`), so the income- and trade-tax bases — and the federal revenue the
 * per-turn `treasuryTurn` accrues against — track the live economy instead of
 * jumping once a year. `fiscalYear` no longer grows the bases (it would
 * double-count); it keeps the annual inflation snapshot, GDP derivation, grants,
 * debt, and the state-revenue reconciliation (off these grown bases).
 *
 * Runs AFTER `computeNationalMetrics` (reads the fresh national rates) and BEFORE
 * `tradeGrowthMirror` (which reads the `economicFactors.tradeGrowth` this phase
 * writes). Federal bases grow on the NATIONAL rates; each state's bases grow on
 * THAT state's own rates (the engine writes per-state factors).
 */
function resolveBudgetCountryId(budget: Pick<FederalBudget, "_id" | "countryId">): CountryId {
  return (budget.countryId ||
    (String(budget._id) === "federal" ? "US" : String(budget._id))) as CountryId;
}

function metricRate(
  metrics: StateMetrics | undefined,
  key: "wageGrowth" | "tradeGrowth" | "gdpGrowth",
  fallback: number
): number {
  const v = metrics?.economic?.[key]?.value;
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

export async function processFiscalBaseGrowth(
  _turn: number
): Promise<{ countriesProcessed: number; statesProcessed: number }> {
  const db = await getDb();
  const [federalBudgets, stateBudgets, allStateMetrics, states] = await Promise.all([
    db.collection<FederalBudget>("federalBudget").find({}).toArray(),
    db.collection<StateBudget>("stateBudgets").find({}).toArray(),
    db.collection<StateMetrics>("macroMetrics").find({}).toArray(),
    db.collection<State>("states").find({}).toArray(),
  ]);

  const metricsById = new Map(allStateMetrics.map((m) => [String(m._id), m]));
  const stateBudgetById = new Map(stateBudgets.map((b) => [String(b._id), b]));

  let countriesProcessed = 0;
  let statesProcessed = 0;

  for (const budget of federalBudgets) {
    const countryId = resolveBudgetCountryId(budget);
    // Same states this country's per-state base growth already filters below —
    // computed here first so the federal gravity pull (guardrail against the
    // wage/trade-vs-GDP structural drift, see taxBaseGdpShareBaseline) has a
    // live current-GDP figure without waiting for the annual `budget.gdp` sync.
    const countryStates = states.filter(
      (s) => s.countryId === countryId && !NATIONAL_SCOPE_IDS.has(String(s._id))
    );
    const currentGdp = countryStates.reduce((sum, s) => sum + (s.gdp || 0), 0) * 1_000_000;
    const nationalDocId = getNationalDocId(countryId);
    const national = nationalDocId ? metricsById.get(nationalDocId) : undefined;
    const wageGrowth = metricRate(national, "wageGrowth", 3.0);
    const tradeGrowth = metricRate(national, "tradeGrowth", 2.0);
    const gdpGrowth = metricRate(national, "gdpGrowth", 2.5);
    // `??` only substitutes null/undefined, so a NaN inflation reading passed
    // straight through here while its three siblings (wageGrowth, tradeGrowth,
    // gdpGrowth) were all finiteness-checked via metricRate above. That single
    // asymmetry was enough to NaN every tax base: this value is reused for every
    // state, lands in growFederalBases/growStateBases (which do not re-check),
    // and is persisted to federalBudget.taxBases and stateBudgets.taxBases —
    // from which revenue.total, treasuryBalance, debt.principal, debtToGdpRatio
    // and creditRating are all recomputed. Match the siblings.
    const rawInflation = budget.economicFactors?.inflationRate;
    const inflationRate =
      typeof rawInflation === "number" && Number.isFinite(rawInflation) ? rawInflation : 2.5;
    const factors: EconomicGrowthFactors = {
      gdpGrowth,
      wageGrowth,
      inflationRate,
      tradeGrowth,
      lastUpdated: new Date(),
    };

    // Always refresh the consumed factor fields (inflation.ts reads
    // economicFactors.wageGrowth; tradeGrowthMirror reads economicFactors.tradeGrowth),
    // and grow the federal bases by the per-turn slice when present.
    const set: Record<string, unknown> = {
      "economicFactors.wageGrowth": wageGrowth,
      "economicFactors.tradeGrowth": tradeGrowth,
      "economicFactors.lastUpdated": factors.lastUpdated,
    };
    if (budget.taxBases) {
      // Self-heal the gravity baseline once (mirrors eraGdpPerCapitaBaseline in
      // nationalMetrics.ts): first turn it's missing, snapshot each base's
      // CURRENT share of GDP as the target the pull-back will track toward.
      let shareBaseline = budget.taxBaseGdpShareBaseline;
      if (!shareBaseline || Object.keys(shareBaseline).length === 0) {
        shareBaseline = computeTaxBaseGdpShareBaseline(budget.taxBases, currentGdp);
        if (Object.keys(shareBaseline).length > 0) {
          set.taxBaseGdpShareBaseline = shareBaseline;
        }
      }
      const gravity: TaxBaseGravityContext | undefined =
        currentGdp > 0 && shareBaseline && Object.keys(shareBaseline).length > 0
          ? { currentGdp, shareBaseline }
          : undefined;
      set.taxBases = applyPerTurnGrowthToFederalBases(budget.taxBases, factors, gravity);
    }
    await db
      .collection<FederalBudget>("federalBudget")
      .updateOne({ _id: budget._id }, { $set: set });

    // Recompute federal revenue off the freshly grown bases (calculateFederalRevenue
    // reads the persisted taxBases) so the per-turn treasury accrual tracks growth.
    if (budget.taxBases) {
      const normalized = normalizeFederalTaxRates(budget.taxRates);
      if (normalized) {
        const revenue = await calculateFederalRevenue(db, normalized, String(budget._id));
        await db
          .collection<FederalBudget>("federalBudget")
          .updateOne({ _id: budget._id }, { $set: { revenue } });
      }
    }
    countriesProcessed += 1;

    // Grow each state's bases by THAT state's own factors (the engine writes
    // per-state wageGrowth/tradeGrowth). State revenue reconciles annually in
    // fiscalYear off these grown bases — no per-turn state revenue recompute.
    // (countryStates computed above, alongside the federal currentGdp figure.)
    const stateOps: Array<{
      updateOne: {
        filter: { _id: string };
        update: { $set: { taxBases: StateBudget["taxBases"] } };
      };
    }> = [];
    for (const st of countryStates) {
      const sb = stateBudgetById.get(String(st._id));
      if (!sb?.taxBases) continue;
      const sm = metricsById.get(String(st._id));
      const stFactors: EconomicGrowthFactors = {
        gdpGrowth: metricRate(sm, "gdpGrowth", gdpGrowth),
        wageGrowth: metricRate(sm, "wageGrowth", wageGrowth),
        inflationRate,
        tradeGrowth: metricRate(sm, "tradeGrowth", tradeGrowth),
        lastUpdated: factors.lastUpdated,
      };
      stateOps.push({
        updateOne: {
          filter: { _id: String(sb._id) },
          update: { $set: { taxBases: applyPerTurnGrowthToStateBases(sb.taxBases, stFactors) } },
        },
      });
      statesProcessed += 1;
    }
    if (stateOps.length > 0) {
      await db.collection<StateBudget>("stateBudgets").bulkWrite(stateOps);
    }
  }

  return { countriesProcessed, statesProcessed };
}
