import type { Db } from "mongodb";
import { getDb } from "@/lib/mongodb";
import type { GameState } from "@/lib/db/types/gameState";
import { resolveGameYear } from "@/lib/era/era";
import type { State } from "@/lib/db/types/state";
import type {
  PoliticalMetricsDoc,
  PoliticalMetricsHistoryDoc,
} from "@/lib/db/types/politicalMetrics";
import { getCountryDisplayName } from "@/lib/constants/countries";
import { getCatalog } from "@/lib/politicalLegislation/catalog";
import { computeLawCost } from "@/lib/politicalLegislation/costEngine";
import { getEnactedLevels } from "@/lib/politicalLegislation/enactedLevels";
import {
  composeTarget,
  DRIFT_RATE_PER_TURN,
  lawTargets,
  metricModifierRows,
  type ModifierRow,
} from "@/lib/politicalLegislation/dynamics";
import {
  CABINET_RESIDUAL_CAP_PER_SOURCE,
  CABINET_SOURCE_IDS,
  cappedSourceCount,
  CABINET_RESIDUAL_TOTAL_CEILING,
  type CabinetSourceId,
} from "../cabinetResidual";
import { aggregateNationalPoliticalMetrics, categoryScore, overallScore } from "../aggregate";
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
  countryId: PoliticalMetricsCountryId;
  countryDisplayName: string;
  /** Current in-game year and turn, for the masthead series/date line. */
  year: number;
  turn: number;
  overall: number;
  overallStatus: string;
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

/** One cabinet channel's population-weighted contribution to a metric. */
export interface CabinetSourceContribution {
  source: CabinetSourceId;
  value: number;
  /** True when this channel sits at its own ceiling across most of the country. */
  atCap: boolean;
}

export interface MetricModifiersInfo {
  /** Contributing laws (sorted by points desc; L0 rows omitted). */
  laws: ModifierRow[];
  /** Population-weighted mean structural residual (rounded 0.1). */
  residual: number;
  /**
   * Population-weighted mean cabinet residual (rounded 0.1) — the standing
   * contribution of tier settings, ministerial orders and sited estates.
   * Ticket #1129: this term moves the target the engine drifts toward, so
   * omitting it made the served target disagree with the engine and left a
   * player's built estates with no visible effect anywhere.
   */
  cabinet: number;
  /**
   * True when most of the population lives in regions where EVERY cabinet
   * channel for this metric is pinned at ±CABINET_RESIDUAL_CAP_PER_SOURCE. Only
   * then does a further order or estate contribute exactly nothing.
   */
  /**
   * Which cabinet channels actually contribute, largest first, so a player can
   * see WHICH one is moving the metric rather than one aggregate label
   * (ticket #1142). Zero-contribution channels are omitted.
   */
  cabinetBySource: CabinetSourceContribution[];
  cabinetAtCap: boolean;
  /** The per-channel cap, so the UI can name the ceiling rather than hard-code it. */
  cabinetCap: number;
  /**
   * Turns for the value to close half the remaining gap at the engine's drift
   * rate. Derived, so it stays true if the rate is retuned.
   */
  driftHalfLifeTurns: number;
  /** National-view target: composeTarget(nationalPoints, 0, residual + cabinet). */
  target: number;
  /** Drift direction vs the current national value (|gap| ≤ 0.1 = flat). */
  direction: "up" | "down" | "flat";
}

/** Turns to close half a gap at `rate` per turn (exponential half-life). */
export function driftHalfLifeTurns(rate: number): number {
  if (rate <= 0 || rate >= 1) return 0;
  return Math.round(Math.log(0.5) / Math.log(1 - rate));
}

export interface MetricLegislationInfo {
  primary: {
    lawId: string;
    title: string;
    level: number;
    levelName: string;
    /** Annual net (revenue − cost) at the enacted level, local currency. */
    annualNet: number;
  } | null;
  secondaries: Array<{ lawId: string; title: string; level: number; levelName: string }>;
}

/**
 * Relevant Legislation panel data (political-legislation spec §8): each
 * metric's primary law at its enacted level with its annual net, plus the
 * secondaries that touch the metric. Empty map for countries without a
 * new-generation catalog.
 */
async function loadRelevantLegislation(
  db: Db,
  countryId: PoliticalMetricsCountryId,
  states: Pick<State, "_id" | "population" | "gdp">[]
): Promise<{ map: Map<string, MetricLegislationInfo>; levels: Map<string, number> }> {
  const map = new Map<string, MetricLegislationInfo>();
  const levels = await getEnactedLevels(db, countryId);
  const base = {
    gdp: states.reduce((sum, s) => sum + (s.gdp ?? 0), 0) * 1_000_000,
    population: states.reduce((sum, s) => sum + (s.population ?? 0), 0),
  };
  for (const law of getCatalog(countryId)) {
    if (law.kind === "tax" || !law.levels) continue;
    const level = levels.get(law.id) ?? law.baselineLevel ?? 0;
    const levelName = law.levels[level]?.name ?? "";
    if (law.kind === "primary") {
      const metricId = law.targets[0].metricId;
      const { net } = computeLawCost(law.levels[level], base, countryId, null);
      const existing = map.get(metricId) ?? { primary: null, secondaries: [] };
      existing.primary = {
        lawId: law.id,
        title: law.title,
        level,
        levelName,
        annualNet: net,
      };
      map.set(metricId, existing);
    } else {
      for (const target of law.targets) {
        const existing = map.get(target.metricId) ?? { primary: null, secondaries: [] };
        existing.secondaries.push({ lawId: law.id, title: law.title, level, levelName });
        map.set(target.metricId, existing);
      }
    }
  }
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
    db
      .collection<GameState>("gameState")
      .findOne(
        { _id: "current" },
        { projection: { currentYear: 1, currentTurn: 1, startingYear: 1, preset: 1 } }
      ),
  ]);
  if (docs.length === 0) return null;

  const populationByRegion = new Map(states.map((s) => [s._id, s.population ?? 0]));
  const nameByRegion = new Map(states.map((s) => [s._id, s.name]));
  const national = aggregateNationalPoliticalMetrics(docs, populationByRegion);
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
  const halfLife = driftHalfLifeTurns(DRIFT_RATE_PER_TURN);
  const buildMetricModifiers = (metricId: PoliticalMetricId): MetricModifiersInfo => {
    const laws = metricModifierRows(countryId, metricId, enactedLevels);
    const residual = meanResidual(metricId);
    const { mean: cabinet, cappedShare, bySource: cabinetBySource } = meanCabinet(metricId);
    const target = composeTarget(nationalLawPoints[metricId], 0, residual + cabinet);
    const gap = target - national[metricId];
    return {
      laws,
      residual: Math.round(residual * 10) / 10,
      cabinet: Math.round(cabinet * 10) / 10,
      cabinetBySource,
      cabinetAtCap: cappedShare >= 0.5,
      cabinetCap: CABINET_RESIDUAL_CAP_PER_SOURCE,
      driftHalfLifeTurns: halfLife,
      target: Math.round(target * 10) / 10,
      direction: Math.abs(gap) <= 0.1 ? "flat" : gap > 0 ? "up" : "down",
    };
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
    countryId,
    countryDisplayName: getCountryDisplayName(countryId, gameState?.preset),
    year,
    turn: gameState?.currentTurn ?? 1,
    overall: round1(overall),
    overallStatus: statusFor(overall),
    categories,
  };
}
