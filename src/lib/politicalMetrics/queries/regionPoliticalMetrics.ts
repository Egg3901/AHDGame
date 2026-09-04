/**
 * The political registry at REGION scope.
 *
 * Region docs are the substrate the national figure aggregates from
 * (`aggregate.ts`), so every number here is the region's own — not a share of a
 * country total. What the national loader population-weights into one figure,
 * this one reads straight off the single doc.
 *
 * The arithmetic itself lives in `./metricsAssembly` and is shared with the
 * national loader, so a future retune of the drift rate or the cabinet cap
 * cannot make the two views disagree about the same law.
 */

import type { Db } from "mongodb";
import { getDb } from "@/lib/mongodb";
import type { GameState } from "@/lib/db/types/gameState";
import type { State } from "@/lib/db/types/state";
import type { StatePolicy } from "@/lib/db/types/statePolicy";
import type {
  PoliticalMetricsDoc,
  PoliticalMetricsRegionHistoryDoc,
} from "@/lib/db/types/politicalMetrics";
import { resolveGameYear } from "@/lib/era/era";
import { resolveCountryIdentity } from "@/lib/country/countryIdentity";
import { loadDemocraticCompetition } from "@/lib/governanceStyle/loadCompetition";
import {
  scoreGovernanceStyle,
  supportsGovernanceStyle,
  type GovernanceStyleScore,
} from "@/lib/governanceStyle/score";
import { COUNTRY_CONFIGS } from "@/lib/constants/countries";
import { getCatalog } from "@/lib/politicalLegislation/catalog";
import { lawTargets, structuralResidual } from "@/lib/politicalLegislation/dynamics";
import { getEnactedLevels } from "@/lib/politicalLegislation/enactedLevels";
import { regionalDefaultLevel } from "@/lib/politicalLegislation/regionalDefaults";
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
import {
  buildModifiers,
  buildRelevantLegislation,
  cabinetContributionsFor,
  type MetricLegislationInfo,
  type MetricModifiersInfo,
} from "./metricsAssembly";

/** First calendar year of the information era for indicator-list selection. */
const MODERN_INDICATORS_FROM_YEAR = 1990;

/**
 * Cap on served trend entries. The stored series is already capped at
 * REGION_HISTORY_MAX_ENTRIES, so this only bounds the payload if that cap is
 * ever raised past it.
 */
const SERVED_HISTORY_ENTRIES = 180;

export interface RegionPoliticalMetricsResponse {
  /** Which registry this is; the views branch display on it. */
  scope: "region";
  countryId: PoliticalMetricsCountryId;
  countryDisplayName: string;
  regionId: string;
  regionName: string;
  /** "State", "Region", "Republic" — this country's word for a region. */
  regionLabel: string;
  /** Its plural, taken from the country config rather than pluralised by hand. */
  regionLabelPlural: string;
  year: number;
  turn: number;
  /** Turns between trend snapshots, so the UI can label a delta honestly. */
  historyCadenceTurns: number;
  /** This region's mean of nine category scores. */
  overall: number;
  overallStatus: string;
  /** The country figure, for the comparison line. */
  nationalOverall: number;
  /**
   * Political direction and democratic health, scored from THIS region's
   * board. Both halves derive from the metric values, which are per region;
   * only the party-competition penalty inside democratic health is a country
   * figure, and it applies to every region of that country equally. Absent
   * for a one-party state, where the score has no meaning.
   */
  governanceStyle?: GovernanceStyleScore;
  categories: Array<{
    id: string;
    displayName: string;
    score: number;
    status: string;
    nationalScore: number;
    metrics: Array<{
      id: string;
      lean: number;
      leanLabel: string;
      displayName: string;
      description: string;
      pos: string[];
      neg: string[];
      indicators: string[];
      /** THIS REGION's value — the field the shared cards render. */
      value: number;
      /** The country value, for the comparison chip. */
      national: number;
      status: string;
      legislation: MetricLegislationInfo | null;
      /** This region's own trend series (empty until history accumulates). */
      history: Array<{ turn: number; value: number }>;
      modifiers: MetricModifiersInfo;
      evidence: EvidenceRow[];
      /** Every region's value for this metric, this one included. */
      regions: Array<{ regionId: string; name: string; value: number }>;
    }>;
  }>;
}

/**
 * The region's own enacted level for every law it may legislate on.
 *
 * A `both` law with no `statePolicies` row falls back to `regionalDefaultLevel`
 * (0): a region starts with no programme of its own on top of the national law.
 * Regional-only sidecars seed their own baseline and are read straight from the
 * row when present.
 */
function regionEnactedLevels(
  countryId: string,
  rows: Pick<StatePolicy, "legislationTypeId" | "policyOptionIndex">[]
): Map<string, number> {
  const recorded = new Map(rows.map((r) => [r.legislationTypeId, r.policyOptionIndex]));
  const levels = new Map<string, number>();
  for (const law of getCatalog(countryId)) {
    // Tax law state lives in the budget, not statePolicies; national-only laws
    // are not a region's to legislate.
    if (law.kind === "tax" || law.allowedScope === "national") continue;
    const index = recorded.get(law.id);
    levels.set(
      law.id,
      typeof index === "number"
        ? Math.max(0, Math.min(4, index))
        : (regionalDefaultLevel(law.id) ?? 0)
    );
  }
  return levels;
}

export async function loadRegionPoliticalMetrics(
  countryId: PoliticalMetricsCountryId,
  regionId: string,
  dbOverride?: Db
): Promise<RegionPoliticalMetricsResponse | null> {
  const db = dbOverride ?? (await getDb());
  const [docs, states, gameState, historyDoc, regionRows] = await Promise.all([
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
          // Read by loadDemocraticCompetition for the executive-continuity
          // line. Projecting it away would silently score every region's
          // governance card as if no executive had ever been re-elected.
          presidentialTenureByCountry: 1,
        },
      }
    ),
    db
      .collection<PoliticalMetricsRegionHistoryDoc>("politicalMetricsRegionHistory")
      .findOne({ _id: regionId }, { projection: { entries: { $slice: -SERVED_HISTORY_ENTRIES } } }),
    db
      .collection<StatePolicy>("statePolicies")
      .find(
        { scope: "state", stateId: regionId },
        { projection: { legislationTypeId: 1, policyOptionIndex: 1 } }
      )
      .toArray(),
  ]);

  const regionDoc = docs.find((d) => d._id === regionId);
  if (!regionDoc) return null;

  const populationByRegion = new Map(states.map((s) => [s._id, s.population ?? 0]));
  const nameByRegion = new Map(states.map((s) => [s._id, s.name]));
  const national = aggregateNationalPoliticalMetrics(docs, populationByRegion);

  const nationalLevels = await getEnactedLevels(db, countryId);
  const regionalLevels = regionEnactedLevels(countryId, regionRows);
  const nationalPoints = lawTargets(countryId, nationalLevels);
  const regionalPoints = lawTargets(countryId, regionalLevels);

  /**
   * Relevant Legislation shows the law IN FORCE here, which for anything but a
   * regional sidecar is the NATIONAL one.
   *
   * Reading this panel off `regionalLevels` instead would break it twice over:
   * a nationally enacted programme the region has never legislated on has no
   * regional row, so it would render at level 0 and claim the country has no
   * such law at all; and its annual net would be priced against one region's
   * GDP, understating a national programme by orders of magnitude. The region's
   * own supplement is not lost — it is the `regionalLaws` rows in Active
   * Modifiers, at the half weight the engine actually applies.
   */
  const effectiveLevels = new Map(nationalLevels);
  for (const law of getCatalog(countryId)) {
    if (law.allowedScope === "regional") {
      effectiveLevels.set(law.id, regionalLevels.get(law.id) ?? 0);
    }
  }
  const nationalBase = {
    gdp: states.reduce((sum, s) => sum + (s.gdp ?? 0), 0) * 1_000_000,
    population: states.reduce((sum, s) => sum + (s.population ?? 0), 0),
  };
  const legislationByMetric = buildRelevantLegislation(
    countryId,
    effectiveLevels,
    nationalBase,
    (law) => law.baselineLevel ?? 0
  );

  const year = (gameState ? resolveGameYear(gameState) : null) ?? 1953;
  const indicatorEra = year >= MODERN_INDICATORS_FROM_YEAR ? "modern" : "early";
  const evidenceByFamily = await loadEvidence(db, countryId, year, regionId);

  const round1 = (v: number) => Math.round(v * 10) / 10;

  const buildMetricModifiers = (metricId: PoliticalMetricId): MetricModifiersInfo => {
    const cabinet = cabinetContributionsFor(regionDoc, metricId);
    // Mirrors the turn phase's lazy self-heal: a doc without residuals derives
    // its structural gap from the composed law target, so the panel agrees with
    // what the engine would compute on its next touch. Shared derivation, so
    // that stays true — this used to omit the region's own supplement and read
    // 0.5 x supplement high for the turn after a region changed country, which
    // is exactly when a board has no residuals to show.
    const residual =
      regionDoc.residuals?.[metricId] ??
      structuralResidual(
        regionDoc.values[metricId] ?? 0,
        nationalPoints[metricId],
        regionalPoints[metricId] ?? 0
      );
    return buildModifiers({
      countryId,
      metricId,
      nationalLevels,
      regionalLevels,
      nationalPoints: nationalPoints[metricId],
      regionalSupplementPoints: regionalPoints[metricId],
      residual,
      cabinet: cabinet.total,
      labour: regionDoc.labourResiduals?.[metricId] ?? 0,
      cabinetBySource: cabinet.bySource,
      cabinetAtCap: cabinet.saturated,
      currentValue: regionDoc.values[metricId] ?? 0,
    });
  };

  /**
   * Unrounded category means, kept beside the rounded display scores.
   *
   * `overall` is compared against `nationalOverall` right next to it in the
   * masthead, and `overallScore` builds the national figure from UNROUNDED
   * category means. Averaging the rounded ones here would give the two
   * neighbouring numbers different arithmetic and let the delta chip disagree
   * with the figures it sits between.
   */
  const exactCategoryScores: number[] = [];

  const categories = POLITICAL_METRIC_CATEGORIES.map((cat) => {
    const regionValues = FAMILIES_BY_CATEGORY[cat.id].map((f) => regionDoc.values[f.id] ?? 0);
    const score = regionValues.reduce((sum, v) => sum + v, 0) / regionValues.length;
    exactCategoryScores.push(score);
    return {
      id: cat.id,
      displayName: getCategoryDisplayName(countryId, cat.id),
      score: round1(score),
      status: statusFor(score),
      nationalScore: round1(categoryScore(national, cat.id)),
      metrics: FAMILIES_BY_CATEGORY[cat.id].map((f) => {
        const value = regionDoc.values[f.id] ?? 0;
        return {
          id: f.id,
          lean: f.lean,
          leanLabel: leanLabelFor(f.lean),
          displayName: getMetricDisplayName(countryId, f.id),
          description: f.description,
          pos: f.pos,
          neg: f.neg,
          indicators: f.indicators[indicatorEra],
          value: round1(value),
          national: round1(national[f.id]),
          status: statusFor(value),
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

  const regionOverall =
    exactCategoryScores.reduce((sum, s) => sum + s, 0) / (exactCategoryScores.length || 1);
  const identity = await resolveCountryIdentity(db, countryId, gameState?.preset);

  /**
   * The same card the national registry shows, scored from this region's own
   * values rather than the country aggregate — a region really does have its
   * own political direction and its own democratic health.
   *
   * The competition penalty folded into democratic health is national (it
   * measures the country's party competition), which is correct: one lopsided
   * national legislature bears on every region alike, exactly as the turn phase
   * applies national approval to every region.
   */
  const governanceStyle = supportsGovernanceStyle(identity.governmentType)
    ? scoreGovernanceStyle(
        regionDoc.values,
        await loadDemocraticCompetition(db, countryId, gameState?.preset, gameState)
      )
    : undefined;

  return {
    scope: "region" as const,
    countryId,
    countryDisplayName: identity.name,
    regionId,
    regionName: nameByRegion.get(regionId) ?? regionId,
    regionLabel: COUNTRY_CONFIGS[countryId]?.regionLabel ?? "Region",
    regionLabelPlural: COUNTRY_CONFIGS[countryId]?.regionLabelPlural ?? "Regions",
    year,
    turn: gameState?.currentTurn ?? 1,
    historyCadenceTurns: HISTORY_CADENCE_TURNS,
    overall: round1(regionOverall),
    overallStatus: statusFor(regionOverall),
    nationalOverall: round1(overallScore(national)),
    governanceStyle,
    categories,
  };
}
