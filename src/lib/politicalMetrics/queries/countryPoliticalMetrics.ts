import type { Db } from "mongodb";
import { getDb } from "@/lib/mongodb";
import type { GameState } from "@/lib/db/types/gameState";
import { resolveGameYear } from "@/lib/era/era";
import type { State } from "@/lib/db/types/state";
import type {
  PoliticalMetricsDoc,
  PoliticalMetricsHistoryDoc,
} from "@/lib/db/types/politicalMetrics";
import { resolveCountryIdentity } from "@/lib/country/countryIdentity";
import { loadDemocraticCompetition } from "@/lib/governanceStyle/loadCompetition";
import { scoreGovernanceStyle, type GovernanceStyleScore } from "@/lib/governanceStyle/score";
import { getEnactedLevels } from "@/lib/politicalLegislation/enactedLevels";
import { lawTargets } from "@/lib/politicalLegislation/dynamics";
import {
  CABINET_RESIDUAL_CAP_PER_SOURCE,
  CABINET_RESIDUAL_TOTAL_CEILING,
  CABINET_SOURCE_IDS,
  cappedSourceCount,
  type CabinetSourceId,
} from "../cabinetResidual";
import {
  buildModifiers,
  buildRelevantLegislation,
  type CabinetSourceContribution,
  type MetricLegislationInfo,
  type MetricModifiersInfo,
} from "./metricsAssembly";
import { aggregateNationalPoliticalMetrics, categoryScore, overallScore } from "../aggregate";
import { HISTORY_CADENCE_TURNS } from "../historyCadence";
import { loadEvidence, type EvidenceRow } from "../evidence";
import { FAMILIES_BY_CATEGORY } from "../families";
import { leanLabelFor, statusFor } from "../display";
import { getCategoryDisplayName, getMetricDisplayName } from "../names";
import {
  POLITICAL_METRIC_CATEGORIES,
  type PoliticalMetricId,
  type PoliticalMetricsCountryId,
} from "../types";

export interface CountryPoliticalMetricsResponse {
  /** Which registry this is; the views branch display on it. */
  scope: "national";
  countryId: PoliticalMetricsCountryId;
  countryDisplayName: string;
  /** Current in-game year and turn, for the masthead series/date line. */
  year: number;
  turn: number;
  /** Turns between trend snapshots, so the UI can label a delta honestly. */
  historyCadenceTurns: number;
  overall: number;
  overallStatus: string;
  governanceStyle: GovernanceStyleScore;
  categories: Array<{
    id: string;
    displayName: string;
    score: number;
    status: string;
    metrics: Array<{
      id: string;
      lean: number;
      leanLabel: string;
      displayName: string;
      description: string;
      pos: string[];
      neg: string[];
      indicators: string[];
      /**
       * The value at THIS payload's scope. A duplicate of `nationalValue`
       * here, and the region payload's own figure there, so one card component
       * renders both scopes without an adapter that reassigns fields.
       */
      value: number;
      nationalValue: number;
      status: string;
      legislation: MetricLegislationInfo | null;
      /** SP2 §5: this metric's national trend series (empty until history exists). */
      history: Array<{ turn: number; value: number }>;
      /** SP2 §6: the target decomposition driving the Active-modifiers panel. */
      modifiers: MetricModifiersInfo;
      /** SP6: underlying raw statistics ([] when the family has no mapping). */
      evidence: EvidenceRow[];
      regions: Array<{ regionId: string; name: string; value: number }>;
    }>;
  }>;
}

/** First calendar year of the information era for indicator-list selection (display flavor only). */
const MODERN_INDICATORS_FROM_YEAR = 1990;

// The modifiers decomposition lives in ./metricsAssembly so the region loader
// shares this exact arithmetic. Re-exported here because the dashboard
// components import these types from this module.
export type { CabinetSourceContribution, MetricModifiersInfo } from "./metricsAssembly";
export { driftHalfLifeTurns } from "./metricsAssembly";

// The legislation join lives in ./metricsAssembly so the region loader can run
// the same join against its OWN enacted levels.
export type { MetricLegislationInfo } from "./metricsAssembly";

/** National Relevant-Legislation map: the national law book at authored baselines. */
async function loadRelevantLegislation(
  db: Db,
  countryId: PoliticalMetricsCountryId,
  states: Pick<State, "_id" | "population" | "gdp">[]
): Promise<{ map: Map<string, MetricLegislationInfo>; levels: Map<string, number> }> {
  const levels = await getEnactedLevels(db, countryId);
  const base = {
    gdp: states.reduce((sum, s) => sum + (s.gdp ?? 0), 0) * 1_000_000,
    population: states.reduce((sum, s) => sum + (s.population ?? 0), 0),
  };
  const map = buildRelevantLegislation(countryId, levels, base, (law) => law.baselineLevel ?? 0);
  return { map, levels };
}

export async function loadCountryPoliticalMetrics(
  countryId: PoliticalMetricsCountryId,
  dbOverride?: Db
): Promise<CountryPoliticalMetricsResponse | null> {
  const db = dbOverride ?? (await getDb());
  const [docs, states, gameState] = await Promise.all([
    db.collection<PoliticalMetricsDoc>("politicalMetrics").find({ countryId }).toArray(),
    db
      .collection<State>("states")
      .find({ countryId }, { projection: { name: 1, population: 1, gdp: 1 } })
      .toArray(),
    db.collection<GameState>("gameState").findOne(
      { _id: "current" },
      {
        projection: {
          currentYear: 1,
          currentTurn: 1,
          startingYear: 1,
          preset: 1,
          presidentialTenureByCountry: 1,
        },
      }
    ),
  ]);
  if (docs.length === 0) return null;

  const populationByRegion = new Map(states.map((s) => [s._id, s.population ?? 0]));
  const nameByRegion = new Map(states.map((s) => [s._id, s.name]));
  const national = aggregateNationalPoliticalMetrics(docs, populationByRegion);
  const competition = await loadDemocraticCompetition(db, countryId, gameState?.preset, gameState);
  const governanceStyle = scoreGovernanceStyle(national, competition);
  const { map: legislationByMetric, levels: enactedLevels } = await loadRelevantLegislation(
    db,
    countryId,
    states
  );

  // SP2 (§5/§6): trend history + the modifiers decomposition — the dynamics
  // engine's own arithmetic served read-time. The stored series caps at 365
  // entries; SERVE only the most recent 180 (≈6 real months) so the payload
  // stays bounded (63 metrics × entries — a full year would push ~1MB).
  const SERVED_HISTORY_ENTRIES = 180;
  const historyDoc = await db
    .collection<PoliticalMetricsHistoryDoc>("politicalMetricsHistory")
    .findOne({ _id: countryId }, { projection: { entries: { $slice: -SERVED_HISTORY_ENTRIES } } });
  const nationalLawPoints = lawTargets(countryId, enactedLevels);
  const totalPopulation = states.reduce((sum, s) => sum + (s.population ?? 0), 0);
  const meanResidual = (metricId: PoliticalMetricId): number => {
    if (totalPopulation <= 0) return 0;
    let weighted = 0;
    for (const doc of docs) {
      const weight = populationByRegion.get(doc._id) ?? 0;
      const residual =
        doc.residuals?.[metricId] ?? (doc.values[metricId] ?? 0) - nationalLawPoints[metricId];
      weighted += residual * weight;
    }
    return weighted / totalPopulation;
  };
  /**
   * Population-weighted mean cabinet residual, plus the share of population for
   * which the channel can absorb nothing more. Ticket #1129: players reported
   * built estates doing nothing, because a single global cap meant a saturated
   * order book zeroed every other channel too.
   *
   * The cap is now per channel, so "at cap" is only true when EVERY channel is
   * pinned. Anything less and there is still a channel a player can build in,
   * which is exactly the case the old warning would have called hopeless.
   * A doc with no per-source split yet (written before the change, or a region
   * the ministerial step has not touched since) falls back to comparing its
   * flat total against the full ceiling, which is the same question.
   */
  const meanCabinet = (
    metricId: PoliticalMetricId
  ): { mean: number; cappedShare: number; bySource: CabinetSourceContribution[] } => {
    if (totalPopulation <= 0) return { mean: 0, cappedShare: 0, bySource: [] };
    let weighted = 0;
    let cappedWeight = 0;
    // Ticket #1142: a player saw a negative "Cabinet, orders and estates" line on a
    // US infrastructure metric and asked which cabinet action could possibly be
    // doing that. The honest answer was none of them: it was the energy channel
    // alone, left saturated by a units bug that is now fixed. One aggregate label
    // could not say that, so carry the split through to the panel.
    const sourceWeighted = new Map<CabinetSourceId, number>();
    const sourceCappedWeight = new Map<CabinetSourceId, number>();
    for (const doc of docs) {
      const weight = populationByRegion.get(doc._id) ?? 0;
      const cabinet = doc.cabinetResiduals?.[metricId] ?? 0;
      weighted += cabinet * weight;
      const bySource = doc.cabinetResidualsBySource;
      const saturated = bySource
        ? cappedSourceCount(bySource, metricId) >= CABINET_SOURCE_IDS.length
        : Math.abs(cabinet) >= CABINET_RESIDUAL_TOTAL_CEILING - 0.01;
      if (saturated) cappedWeight += weight;
      for (const source of CABINET_SOURCE_IDS) {
        const value = bySource?.[source]?.[metricId] ?? 0;
        if (value !== 0)
          sourceWeighted.set(source, (sourceWeighted.get(source) ?? 0) + value * weight);
        if (Math.abs(value) >= CABINET_RESIDUAL_CAP_PER_SOURCE - 0.01) {
          sourceCappedWeight.set(source, (sourceCappedWeight.get(source) ?? 0) + weight);
        }
      }
    }
    const bySource: CabinetSourceContribution[] = CABINET_SOURCE_IDS.map((source) => ({
      source,
      value: Math.round(((sourceWeighted.get(source) ?? 0) / totalPopulation) * 10) / 10,
      atCap: (sourceCappedWeight.get(source) ?? 0) / totalPopulation >= 0.5,
    }))
      .filter((row) => row.value !== 0)
      .sort((a, b) => Math.abs(b.value) - Math.abs(a.value));
    return {
      mean: weighted / totalPopulation,
      cappedShare: cappedWeight / totalPopulation,
      bySource,
    };
  };
  /**
   * The national view has no regional supplement and no single region's labour
   * term to show: both are per-region quantities, and a population-weighted
   * mean of them would double-count what `residuals` already carries. So the
   * supplement is 0 and `regionalLevels` is empty here; the region loader is
   * the scope that fills them in.
   */
  const buildMetricModifiers = (metricId: PoliticalMetricId): MetricModifiersInfo => {
    const { mean: cabinet, cappedShare, bySource: cabinetBySource } = meanCabinet(metricId);
    return buildModifiers({
      countryId,
      metricId,
      nationalLevels: enactedLevels,
      regionalLevels: new Map(),
      nationalPoints: nationalLawPoints[metricId],
      regionalSupplementPoints: 0,
      residual: meanResidual(metricId),
      cabinet,
      labour: 0,
      cabinetBySource,
      cabinetAtCap: cappedShare >= 0.5,
      currentValue: national[metricId],
    });
  };
  // Via resolveGameYear, not `currentYear ?? 1953`: legacy rows carry only
  // turn + startingYear, and defaulting those to 1953 would mis-date the
  // indicator era and the evidence lookup.
  const year = (gameState ? resolveGameYear(gameState) : null) ?? 1953;
  const indicatorEra = year >= MODERN_INDICATORS_FROM_YEAR ? "modern" : "early";
  // SP6: national raw-statistics evidence for mapped families (spec §D).
  const evidenceByFamily = await loadEvidence(db, countryId, year);

  const round1 = (v: number) => Math.round(v * 10) / 10;
  const categories = POLITICAL_METRIC_CATEGORIES.map((cat) => {
    const score = categoryScore(national, cat.id);
    return {
      id: cat.id,
      displayName: getCategoryDisplayName(countryId, cat.id),
      score: round1(score),
      status: statusFor(score),
      metrics: FAMILIES_BY_CATEGORY[cat.id].map((f) => {
        const nationalValue = national[f.id];
        return {
          id: f.id,
          lean: f.lean,
          leanLabel: leanLabelFor(f.lean),
          displayName: getMetricDisplayName(countryId, f.id),
          description: f.description,
          pos: f.pos,
          neg: f.neg,
          indicators: f.indicators[indicatorEra],
          value: round1(nationalValue),
          nationalValue: round1(nationalValue),
          status: statusFor(nationalValue),
          legislation: legislationByMetric.get(f.id) ?? null,
          history: (historyDoc?.entries ?? []).map((entry) => ({
            turn: entry.turn,
            value: round1(entry.values[f.id] ?? 0),
          })),
          modifiers: buildMetricModifiers(f.id),
          evidence: evidenceByFamily.get(f.id) ?? [],
          regions: docs
            .map((d) => ({
              regionId: d._id,
              name: nameByRegion.get(d._id) ?? d._id,
              value: round1(d.values[f.id] ?? 0),
            }))
            .sort((a, b) => b.value - a.value),
        };
      }),
    };
  });

  const overall = overallScore(national);
  return {
    scope: "national" as const,
    countryId,
    // Resolved, not compiled: this name heads the registry masthead, the
    // comparison chips and every column of the comparison table, so a country
    // renamed at runtime must not be listed under the name it no longer uses.
    countryDisplayName: (await resolveCountryIdentity(db, countryId, gameState?.preset)).name,
    year,
    turn: gameState?.currentTurn ?? 1,
    historyCadenceTurns: HISTORY_CADENCE_TURNS,
    overall: round1(overall),
    overallStatus: statusFor(overall),
    governanceStyle,
    categories,
  };
}
