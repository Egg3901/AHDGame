import { findMergedRegionMetricsMany } from "@/lib/macroMetrics/merge";
import { resetApprovalDirections } from "@/lib/resetMetrics/rules/approval";
/**
 * Government approval bases and named conditions share one version-aware loader.
 * Metrics v2 compares current owner outcomes with the country's regional mean;
 * v1 retains its hybrid political board. Surfaces apply conditions and damping
 * through the shared scorer after loading these inputs once per country.
 */

import { isResetV2Country } from "@/lib/resetVersions/rules";
import type { GameState } from "@/lib/db/types/gameState";
import type { ActiveModifier } from "@/lib/utils/approvalModifiers";
import { loadResetApprovalModifiers } from "@/lib/resetMetrics/loadApprovalModifiers";
import type { Db } from "mongodb";
import type { PoliticalMetricsDoc } from "@/lib/db/types/politicalMetrics";
import type { State } from "@/lib/db/types/state";
import type { CountryId } from "@/lib/constants/countries";
import { resolveGameYear } from "@/lib/era/era";
import {
  BASE_APPROVAL,
  computeStateApprovalBase,
  computeNationalAveragesFromMetrics,
  loadElectorateGroups,
  weightingFor,
} from "@/lib/utils/governmentApproval";
import { POLITICAL_METRIC_COUNTRY_IDS } from "@/lib/politicalMetrics/types";
import { NON_PLAYABLE_BOARDS } from "@/lib/politicalMetrics/seeds/nonPlayableBoards";
import { approvalComponent, electorateLean } from "./politicalApproval";

/**
 * Every country whose political metrics come from the board: the four
 * anchor-seeded playables plus the 22 derived non-playables.
 *
 * Built from the board file rather than hand-listed so adding a country to the
 * derivation cannot leave its consumers reading a collection that no longer
 * carries it.
 */
const BOARD_COUNTRIES = new Set<string>([
  ...POLITICAL_METRIC_COUNTRY_IDS,
  // NON_PLAYABLE_BOARDS is keyed by PRESET first, so flatten a level: the top
  // keys are eras, not countries. Reading them directly would make every
  // predicate answer "is this country called 1953-default?".
  ...Object.values(NON_PLAYABLE_BOARDS).flatMap((byCountry) => Object.keys(byCountry)),
]);

/**
 * True when the country's political consumers read the new-generation pipeline.
 * Approval consumers opt in to v2 successors; legacy political writes do not.
 *
 * Narrows to `CountryId`, not `PoliticalMetricsCountryId`: every member of the
 * set is a real country, but the narrow union means "has authored baseline
 * anchors" and is still just the four playables. Asserting it here would let
 * anchor-only lookups compile against countries that have none.
 */
export function isPoliticalApprovalCountry(
  countryId: string | null | undefined,
  includeMetricsV2Successors = false
): countryId is CountryId {
  return (
    countryId != null &&
    (BOARD_COUNTRIES.has(countryId) || (includeMetricsV2Successors && isResetV2Country(countryId)))
  );
}

export interface PoliticalApprovalBases {
  /** stateId → base approval (BASE_APPROVAL + component, clamped 0–100, rounded 0.1). */
  byRegion: Map<string, number>;
  /** Owner-derived named conditions when Metrics v2 is active. */
  modifiersByRegion?: Map<string, ActiveModifier[]>;
  /** Population-weighted national base (same rounding). */
  national: number;
}

const round1 = (v: number) => Math.round(v * 10) / 10;
const clamp100 = (v: number) => Math.max(0, Math.min(100, v));

/**
 * Load every region's hybrid approval base for one playable country.
 * Returns null when the country has no politicalMetrics docs (pre-seed or
 * non-1953 world) — callers then use BASE_APPROVAL, never the legacy scorer.
 */
export async function loadPoliticalApprovalBases(
  db: Db,
  countryId: CountryId,
  turn?: number
): Promise<PoliticalApprovalBases | null> {
  // The world's preset picks which era's intercept to score against — a
  // non-playable's board sits at a different level per era, so the wrong
  // intercept would lurch its approval.
  const [gameState, states] = await Promise.all([
    db.collection<GameState>("gameState").findOne(
      { _id: "current" },
      {
        projection: {
          preset: 1,
          currentTurn: 1,
          currentYear: 1,
          startingYear: 1,
          eraSystemEnabled: 1,
          resetWorldId: 1,
          resetVersionSeeds: 1,
          metricsSystemVersion: 1,
          cabinetSystemVersion: 1,
          isProcessing: 1,
          processingKind: 1,
          processingTargetTurn: 1,
        },
      }
    ),
    db
      .collection<State>("states")
      .find(
        { countryId },
        { projection: { _id: 1, population: 1, cachedEconomicLean: 1, cachedSocialLean: 1 } }
      )
      .toArray(),
  ]);
  const resetInputs = await loadResetApprovalModifiers(
    db,
    countryId,
    states.map((state) => String(state._id)),
    gameState,
    turn
  );
  if (resetInputs) {
    const averages = computeNationalAveragesFromMetrics(resetInputs.metrics);
    const year = gameState?.eraSystemEnabled ? resolveGameYear(gameState) : null;
    const byRegion = new Map(
      resetInputs.metrics.map((metrics) => [
        String(metrics._id),
        computeStateApprovalBase(
          metrics,
          averages,
          undefined,
          gameState?.preset,
          year,
          resetApprovalDirections
        ),
      ])
    );
    const totalPop = states.reduce((sum, state) => sum + Math.max(0, state.population ?? 0), 0);
    const national =
      totalPop > 0
        ? round1(
            states.reduce(
              (sum, state) =>
                sum +
                (byRegion.get(String(state._id)) ?? BASE_APPROVAL) *
                  Math.max(0, state.population ?? 0),
              0
            ) / totalPop
          )
        : BASE_APPROVAL;
    return { byRegion, national, modifiersByRegion: resetInputs.modifiersByRegion };
  }
  // Successors in a v1 world still use the original relative metric scorer.
  // Opting approval into successor routing must not replace that base with 50.
  if (isResetV2Country(countryId) && !isPoliticalApprovalCountry(countryId)) {
    const [metrics, groups] = await Promise.all([
      findMergedRegionMetricsMany(db, {
        countryId,
        _id: { $in: states.map((state) => state._id) },
      }),
      loadElectorateGroups(db, { countryId }),
    ]);
    const averages = computeNationalAveragesFromMetrics(metrics);
    const year = gameState?.eraSystemEnabled ? resolveGameYear(gameState) : null;
    const byRegion = new Map(
      metrics.map((metric) => [
        String(metric._id),
        computeStateApprovalBase(
          metric,
          averages,
          weightingFor(groups, countryId, String(metric._id)),
          gameState?.preset,
          year
        ),
      ])
    );
    const totalPop = states.reduce((sum, state) => sum + Math.max(0, state.population ?? 0), 0);
    const national =
      totalPop > 0
        ? round1(
            states.reduce(
              (sum, state) =>
                sum +
                (byRegion.get(String(state._id)) ?? BASE_APPROVAL) *
                  Math.max(0, state.population ?? 0),
              0
            ) / totalPop
          )
        : BASE_APPROVAL;
    return { byRegion, national };
  }
  const docs = await db
    .collection<PoliticalMetricsDoc>("politicalMetrics")
    .find({ countryId })
    .toArray();
  if (docs.length === 0) return null;

  const stateById = new Map(states.map((s) => [s._id, s]));
  const byRegion = new Map<string, number>();
  let weighted = 0;
  let totalPop = 0;
  for (const doc of docs) {
    const state = stateById.get(doc._id);
    if (!state) continue;
    const lean = state ? electorateLean(state) : 0;
    const base = round1(
      clamp100(BASE_APPROVAL + approvalComponent(doc.values, lean, countryId, gameState?.preset))
    );
    byRegion.set(doc._id, base);
    const pop = state?.population ?? 0;
    if (pop > 0) {
      weighted += base * pop;
      totalPop += pop;
    }
  }
  const national = totalPop > 0 ? round1(clamp100(weighted / totalPop)) : BASE_APPROVAL;
  return { byRegion, national };
}
