/**
 * SP6 — "Underlying statistics" evidence for registry metric detail views.
 * Declarative family → raw-series mapping; resolved server-side (national
 * scope only, v1) from macroMetrics + centralBanks + federalBudget. The
 * registry stays the ONLY metrics product — these rows are supporting
 * statistics, not a second system.
 */
import type { Db } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";
import { getNationalDocId } from "@/lib/constants/nationalScope";
import { getBankId } from "@/lib/centralBank/helpers";
import { getNationalBudgetId } from "@/lib/bonds/sovereign";
import { getMetricDefinition } from "@/lib/constants/metricDefinitions";
import { getEraMetricName } from "@/lib/era/metricCatalog";
import type { MetricCategoryId, StateMetricValue } from "@/lib/db/types";
import type { PoliticalMetricId } from "./types";

export type EvidenceSource =
  | { kind: "macro"; category: "economic" | "population"; metricId: string }
  | { kind: "bank"; field: "primeRate" }
  | { kind: "budget"; field: "inflationRate" | "debtToGdpRatio" };

export interface EvidenceRow {
  id: string;
  label: string;
  value: number;
  trend: number | null;
  /** A "$" prefix is swapped for the country currency symbol at render time. */
  format: { prefix?: string; suffix?: string; decimals?: number };
}

/** v1 mapping (spec §D). Unlisted families render no evidence panel. */
export const EVIDENCE_SERIES: Partial<Record<PoliticalMetricId, EvidenceSource[]>> = {
  "economy.workerSecurity": [
    { kind: "macro", category: "economic", metricId: "unemploymentRate" },
    { kind: "macro", category: "economic", metricId: "laborParticipation" },
  ],
  "economy.mobility": [
    { kind: "macro", category: "economic", metricId: "povertyRate" },
    { kind: "macro", category: "economic", metricId: "medianIncome" },
  ],
  "economy.householdIncome": [
    { kind: "macro", category: "economic", metricId: "medianIncome" },
    { kind: "macro", category: "economic", metricId: "wageGrowth" },
    { kind: "macro", category: "economic", metricId: "costOfLiving" },
  ],
  "economy.stability": [
    { kind: "budget", field: "inflationRate" },
    { kind: "bank", field: "primeRate" },
    { kind: "macro", category: "economic", metricId: "gdpGrowth" },
  ],
  "economy.productivity": [
    { kind: "macro", category: "economic", metricId: "productivityGrowth" },
    { kind: "macro", category: "economic", metricId: "rdIntensity" },
    { kind: "macro", category: "economic", metricId: "gdpGrowth" },
  ],
  // v1 deviation from spec §D: the budget-balance row is deferred — the stored
  // `surplus` field's unit is inconsistent across consumers; debt-to-GDP
  // carries the fiscal signal until the treasury exposes a normalized figure.
  "economy.fiscal": [{ kind: "budget", field: "debtToGdpRatio" }],
  "economy.competition": [
    { kind: "macro", category: "economic", metricId: "smallBusinessFormation" },
    { kind: "macro", category: "economic", metricId: "economicFreedom" },
    { kind: "macro", category: "economic", metricId: "regulatoryBurden" },
  ],
  "society.demography": [
    { kind: "macro", category: "population", metricId: "populationGrowth" },
    { kind: "macro", category: "population", metricId: "birthRate" },
    { kind: "macro", category: "population", metricId: "medianAge" },
    { kind: "macro", category: "population", metricId: "dependencyRatio" },
  ],
};

const SCALAR_ROWS: Record<
  string,
  { label: string; prefix?: string; suffix?: string; decimals: number }
> = {
  primeRate: { label: "Prime rate", suffix: "%", decimals: 2 },
  inflationRate: { label: "Inflation (annual)", suffix: "%", decimals: 2 },
  debtToGdpRatio: { label: "Debt to GDP", suffix: "%", decimals: 1 },
};

export async function loadEvidence(
  db: Db,
  countryId: CountryId,
  year: number | null = null
): Promise<Map<PoliticalMetricId, EvidenceRow[]>> {
  type MacroDoc = { _id: string } & Partial<
    Record<"economic" | "population", Record<string, StateMetricValue>>
  >;
  const nationalId = getNationalDocId(countryId) ?? "federal";
  const [macro, regionDocs, states, bank, budget] = await Promise.all([
    db.collection<MacroDoc>("macroMetrics").findOne({ _id: nationalId }),
    // Fallback source: the national rollup doc only exists after the first
    // turn; a fresh world aggregates the regional docs population-weighted.
    db
      .collection<MacroDoc>("macroMetrics")
      .find({ countryId } as never)
      .toArray(),
    db
      .collection<{ _id: string; population?: number }>("states")
      .find({ countryId } as never, { projection: { population: 1 } })
      .toArray(),
    db.collection("centralBanks").findOne({ _id: getBankId(countryId) } as never),
    db.collection("federalBudget").findOne({ _id: getNationalBudgetId(countryId) } as never),
  ]);
  const populationById = new Map(states.map((s) => [s._id, s.population ?? 0]));
  const resolveMacro = (
    category: "economic" | "population",
    metricId: string
  ): { value: number; trend: number | null } | null => {
    const rec = macro?.[category]?.[metricId];
    if (typeof rec?.value === "number") {
      return { value: rec.value, trend: typeof rec.trend === "number" ? rec.trend : null };
    }
    let valueSum = 0;
    let trendSum = 0;
    let weight = 0;
    for (const doc of regionDocs) {
      const r = doc[category]?.[metricId];
      const pop = populationById.get(doc._id) ?? 0;
      if (typeof r?.value !== "number" || pop <= 0) continue;
      valueSum += r.value * pop;
      trendSum += (typeof r.trend === "number" ? r.trend : 0) * pop;
      weight += pop;
    }
    if (weight <= 0) return null;
    return {
      value: Math.round((valueSum / weight) * 100) / 100,
      trend: Math.round((trendSum / weight) * 100) / 100,
    };
  };

  const out = new Map<PoliticalMetricId, EvidenceRow[]>();
  for (const [familyId, sources] of Object.entries(EVIDENCE_SERIES)) {
    const rows: EvidenceRow[] = [];
    for (const s of sources!) {
      if (s.kind === "macro") {
        const def = getMetricDefinition(s.category as MetricCategoryId, s.metricId);
        const resolved = def ? resolveMacro(s.category, s.metricId) : null;
        if (!def || !resolved) continue;
        rows.push({
          id: s.metricId,
          label: getEraMetricName(def, year),
          value: resolved.value,
          trend: resolved.trend,
          format: { prefix: def.formatPrefix, suffix: def.formatSuffix, decimals: def.decimals },
        });
      } else {
        const doc = (s.kind === "bank" ? bank : budget) as Record<string, unknown> | null;
        const value =
          s.kind === "budget" && s.field === "inflationRate"
            ? (doc?.economicFactors as { inflationRate?: number } | undefined)?.inflationRate
            : doc?.[s.field];
        if (typeof value !== "number") continue;
        const meta = SCALAR_ROWS[s.field];
        rows.push({
          id: s.field,
          label: meta.label,
          value,
          trend: null,
          format: { prefix: meta.prefix, suffix: meta.suffix, decimals: meta.decimals },
        });
      }
    }
    if (rows.length > 0) out.set(familyId as PoliticalMetricId, rows);
  }
  return out;
}
