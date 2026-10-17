import type { Db } from "mongodb";
import type { StateMetrics, MetricCategoryId, GameState } from "@/lib/db/types";
import type { FederalBudget } from "@/lib/db/types/budget";
import type { State } from "@/lib/db/types/state";
import { NATIONAL_SCOPE, NATIONAL_SCOPE_IDS } from "@/lib/constants/nationalScope";
import { isMacroMetricPath } from "@/lib/macroMetrics/paths";
import { aggregateNationalGdp } from "@/lib/utils/nationalGdp";
import { getIncomeStartVintage, getStartingIncomeAnchor } from "@/lib/era/metricCatalog";
import {
  aggregateNationalLabourDemand,
  aggregateNationalLabourTightness,
  aggregateNationalMetricValue,
} from "./nationalMetrics/rules";

/**
 * Plausible range for the back-solved income-band index at world start. A seed
 * income and its era anchor that imply a ratio outside this band are not
 * measuring the same currency scale (see the 1953 modern-median-income seeds),
 * so the back-solve is skipped in favour of a 1.0 baseline.
 */
export const INCOME_BAND_BACKSOLVE_MIN = 0.4;
export const INCOME_BAND_BACKSOLVE_MAX = 2.5;

const METRIC_CATEGORIES: MetricCategoryId[] = [
  "economic",
  "education",
  "healthcare",
  "infrastructure",
  "publicSafety",
  "environment",
  "social",
  "governance",
  "population",
  "mediaInformation",
];

interface NationalMetricsDoc {
  _id: string;
  [key: string]: unknown;
}

type LabourDemandMetrics = StateMetrics & {
  economic?: StateMetrics["economic"] & { labourDemandTurn?: number };
};

/**
 * Compute weighted national metric averages for each country and upsert them
 * as derived stateMetrics documents ("federal" for US, "uk_national" for UK).
 *
 * Most rates are population-weighted. Unemployment is labor-force-weighted,
 * labor force is summed as a headcount, and GDP growth is GDP-weighted so that
 * larger economies (e.g. California) contribute more to the national average.
 * All states contribute to GDP growth aggregation regardless of owned sector
 * presence — every state has unowned sectors providing baseline economic activity.
 *
 * Run each turn after processStatePolicyEffects + runMetricEngine (the ported
 * gdpGrowth/unemployment phase), before snapshotMetricHistory. These national
 * docs are derived-only — policy effects never write to them directly.
 */
export async function computeNationalMetrics(db: Db, turn?: number): Promise<void> {
  // Regional values that roll up to a national doc are macro (economic /
  // population). The political half of this aggregation is not missing — it is
  // computed nationally by the political pipeline, from the board, rather than
  // being averaged out of per-region legacy docs here.
  const [allStates, regionMetrics, federalBudgets, eraGameState] = await Promise.all([
    db.collection<State>("states").find({}).toArray(),
    db.collection<StateMetrics>("macroMetrics").find({}).toArray(),
    db.collection<FederalBudget>("federalBudget").find({}).toArray(),
    db.collection<GameState>("gameState").findOne(
      { _id: "current" },
      {
        projection: {
          currentYear: 1,
          currentTurn: 1,
          startingYear: 1,
          eraSystemEnabled: 1,
          eraGdpPerCapitaBaseline: 1,
          incomeStartVintages: 1,
        },
      }
    ),
  ]);
  // Era income-band index: only computed while the era system is on.
  const eraOn = eraGameState?.eraSystemEnabled === true;
  const labourDemandTurn = turn ?? eraGameState?.currentTurn;
  const eraStartingYear = eraGameState?.startingYear ?? null;
  const incomeVintages = eraGameState?.incomeStartVintages ?? null;
  const macroRollupOps: Array<{
    updateOne: {
      filter: { _id: string };
      update: { $set: Record<string, unknown>; $unset?: Record<string, ""> };
      upsert: true;
    };
  }> = [];
  const gdpPcBaselines: Record<string, number> = {};
  for (const [k, v] of Object.entries(eraGameState?.eraGdpPerCapitaBaseline ?? {})) {
    if (typeof v === "number" && Number.isFinite(v)) gdpPcBaselines[k] = v;
  }
  const incomeBandIndexByCountry: Record<string, number> = {};
  let baselinesChanged = false;

  // Exclude existing national-scope docs to avoid circular contamination
  const metricsMap = new Map<string, LabourDemandMetrics>();
  for (const m of regionMetrics) {
    if (NATIONAL_SCOPE_IDS.has(String(m._id))) continue;
    metricsMap.set(String(m._id), m as LabourDemandMetrics);
  }
  const budgetByCountry = new Map<string, FederalBudget>();
  for (const budget of federalBudgets) {
    const countryId =
      budget.countryId || (String(budget._id) === "federal" ? "US" : String(budget._id));
    budgetByCountry.set(countryId, budget);
  }

  const countryRollups: Array<[string | null, string]> = Object.entries(NATIONAL_SCOPE);
  const nationalCountries = new Set(Object.values(NATIONAL_SCOPE));
  // Some regional countries have no stored national metrics document. Their
  // newly stamped income vintages still need a GDP index for regional scoring.
  // Missing or unknown stamps retain the existing world's behavior.
  if (eraOn) {
    for (const countryId of new Set(allStates.map((state) => state.countryId))) {
      if (!countryId || nationalCountries.has(countryId)) continue;
      const vintage = getIncomeStartVintage(countryId, eraStartingYear);
      if (vintage && incomeVintages?.[countryId] === vintage.id) {
        countryRollups.push([null, countryId]);
      }
    }
  }

  for (const [nationalId, countryId] of countryRollups) {
    const countryStates = allStates.filter((s) => s.countryId === countryId);
    if (countryStates.length === 0) continue;

    const totalPop = countryStates.reduce((s, st) => s + (st.population ?? 0), 0);
    if (totalPop === 0) continue;

    const setOps: Record<string, { value: number }> = {};
    const unsetOps: Record<string, ""> = {};

    for (const cat of METRIC_CATEGORIES) {
      // Discover metric keys from the first state that has this category
      const sampleCat = countryStates
        .map((s) => metricsMap.get(s._id)?.[cat] as Record<string, { value: number }> | undefined)
        .find(Boolean);
      if (!sampleCat) continue;

      for (const key of Object.keys(sampleCat)) {
        // These are headcounts and ratios, not population-weighted rates. They
        // are handled below with complete, current-turn regional coverage.
        if (cat === "economic" && (key === "labourDemand" || key === "labourTightness")) {
          continue;
        }
        const rows: Array<{
          value: number;
          population: number;
          gdp: number;
          laborForce?: number;
        }> = [];
        for (const state of countryStates) {
          const m = metricsMap.get(state._id);
          const catData = m?.[cat] as Record<string, { value: number }> | undefined;
          const val = catData?.[key]?.value;
          if (typeof val !== "number" || !Number.isFinite(val)) continue;
          const laborForce =
            cat === "economic"
              ? (m?.economic as Record<string, { value: number }> | undefined)?.laborForce?.value
              : undefined;
          rows.push({
            value: val,
            population: state.population ?? 0,
            gdp: state.gdp ?? 0,
            ...(typeof laborForce === "number" ? { laborForce } : {}),
          });
        }
        // A partial sum of regional headcounts is not a national labor-force
        // total. Leave the metric untouched until every region has a valid row.
        if (cat === "economic" && key === "laborForce" && rows.length !== countryStates.length) {
          continue;
        }
        const value = aggregateNationalMetricValue(cat, key, rows);
        if (value !== undefined) setOps[`${cat}.${key}`] = { value };
      }
    }

    if (labourDemandTurn !== undefined) {
      const labourReadings = countryStates.map((state) => {
        const metrics = metricsMap.get(state._id);
        return {
          demand: metrics?.economic?.labourDemand?.value,
          laborForce: metrics?.economic?.laborForce?.value,
          demandTurn: metrics?.economic?.labourDemandTurn,
        };
      });
      const nationalDemand = aggregateNationalLabourDemand(labourReadings, labourDemandTurn);
      const nationalTightness = aggregateNationalLabourTightness(labourReadings, labourDemandTurn);
      if (nationalDemand !== undefined) {
        setOps["economic.labourDemand"] = { value: nationalDemand };
      } else {
        unsetOps["economic.labourDemand"] = "";
        unsetOps["economic.labourDemandTurn"] = "";
      }
      if (nationalTightness !== undefined) {
        setOps["economic.labourTightness"] = { value: nationalTightness };
      } else {
        unsetOps["economic.labourTightness"] = "";
      }
    }

    if (Object.keys(setOps).length === 0 && Object.keys(unsetOps).length === 0) continue;

    const budget = budgetByCountry.get(countryId);
    if (budget?.gdp && budget.gdp > 0) {
      const surplus =
        typeof budget.surplus === "number"
          ? budget.surplus
          : (budget.revenue?.total ?? 0) - (budget.spending?.total ?? 0);
      setOps["governance.budgetBalance"] = {
        value: Math.round((surplus / budget.gdp) * 100 * 1000) / 1000,
      };

      if (typeof budget.debtToGdpRatio === "number") {
        setOps["governance.debtToGdp"] = {
          value: Math.round(budget.debtToGdpRatio * 100 * 1000) / 1000,
        };
      }
    }

    // SP5: national rollup splits by store — macro paths → macroMetrics for
    // every country; political paths (incl. the budget-derived governance
    // mirrors) → stateMetrics for non-playables only (playable political
    // stays demolished).
    const macroSetOps: Record<string, { value: number }> = {};
    const politicalSetOps: Record<string, { value: number }> = {};
    for (const [key, value] of Object.entries(setOps)) {
      (isMacroMetricPath(key) ? macroSetOps : politicalSetOps)[key] = value;
    }
    if (
      nationalId !== null &&
      (Object.keys(macroSetOps).length > 0 || Object.keys(unsetOps).length > 0)
    ) {
      const macroSetFields: Record<string, unknown> = { ...macroSetOps };
      if (labourDemandTurn !== undefined && !unsetOps["economic.labourDemandTurn"]) {
        macroSetFields["economic.labourDemandTurn"] = labourDemandTurn;
      }
      macroRollupOps.push({
        updateOne: {
          filter: { _id: nationalId },
          update: {
            $set: { ...macroSetFields, countryId },
            ...(Object.keys(unsetOps).length > 0 ? { $unset: unsetOps } : {}),
          },
          upsert: true,
        },
      });
    }
    // The national POLITICAL aggregate is not written here any more: every
    // country's political metrics live on the board, whose national view is the
    // read-time population-weighted aggregate (aggregateNationalPoliticalMetrics),
    // not a stored doc. `politicalSetOps` is still assembled above so the split
    // between the two stores stays legible at the point it is made.

    // ── Era income-band index (metric era catalog) ───────────────────────────
    // band(country) = anchor(startingYear) × shape × (gdpPc / gdpPcBaseline).
    // The BASELINE self-heals on the first flag-on turn by back-solving from the
    // realized income norm vs the era anchor — continuity: the effective band at
    // enable centers on the income players actually have, so flipping the flag
    // never jumps income scores. This also covers fresh worlds (seed income ==
    // anchor ⇒ ratio 1 ⇒ baseline = seed GDP/capita), replacing a separate
    // bootstrap snapshot. Quiet + idempotent (only when the baseline is absent),
    // mirroring the eraCrossing self-heal.
    if (eraOn) {
      const { perCapita: gdpPc } = aggregateNationalGdp(countryStates);
      const weightedIncome = setOps["economic.medianIncome"]?.value;
      if (gdpPc > 0) {
        let baseline = gdpPcBaselines[countryId];
        if (!Number.isFinite(baseline) || baseline <= 0) {
          const anchor = getStartingIncomeAnchor(countryId, eraStartingYear, incomeVintages);
          if (
            anchor != null &&
            anchor > 0 &&
            typeof weightedIncome === "number" &&
            weightedIncome > 0
          ) {
            // Back-solve only when the seed income and the era anchor actually
            // agree on a scale. They disagree badly in several 1953 seeds: the
            // UK/DE/IE/BR state baselines carry MODERN median incomes (UK
            // £27-42k against a £4.3k 1953 anchor), which back-solves to a band
            // index of 7-33 instead of ~1. The index multiplies the income term
            // of every costModelV2 law (costEngine.ts), so a UK law priced
            // entirely on that term came out ~7.3x too dear — enough to push UK
            // spending to 184% of GDP, a 147% deficit and an inflation spiral
            // pinned at the 15% cap. Outside the plausible band we treat the
            // pair as mis-calibrated and anchor the baseline at the current
            // GDP-per-capita, i.e. index 1.0 at world start, drifting with the
            // economy thereafter. Live worlds keep any baseline already stored.
            const impliedIndex = weightedIncome / anchor;
            baseline =
              impliedIndex >= INCOME_BAND_BACKSOLVE_MIN && impliedIndex <= INCOME_BAND_BACKSOLVE_MAX
                ? gdpPc / impliedIndex
                : gdpPc;
            gdpPcBaselines[countryId] = baseline;
            baselinesChanged = true;
          }
        }
        if (Number.isFinite(baseline) && baseline > 0) {
          incomeBandIndexByCountry[countryId] = Math.round((gdpPc / baseline) * 10_000) / 10_000;
        }
      }
    }
  }

  if (macroRollupOps.length > 0) {
    await db.collection<NationalMetricsDoc>("macroMetrics").bulkWrite(macroRollupOps);
  }

  // Persist the era income-band state in one write (flag off ⇒ untouched).
  if (eraOn && Object.keys(incomeBandIndexByCountry).length > 0) {
    const set: Record<string, unknown> = { incomeBandIndexByCountry };
    if (baselinesChanged) set.eraGdpPerCapitaBaseline = gdpPcBaselines;
    await db.collection<GameState>("gameState").updateOne({ _id: "current" }, { $set: set });
  }
}
