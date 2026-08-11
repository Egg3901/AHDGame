/**
 * SP4 async provider for the hybrid political approval model (spec §3).
 *
 * The ONE loader every approval surface uses for LAW_COUNTRY_IDS — surfaces
 * fetch the bases once per country and pass them as `baseOverride` into the
 * existing scorers, so named modifiers / address bumps / damping stay shared.
 * A surface must NEVER fall back to the legacy metric scorer for a playable
 * country (one-surface divergence was a real bug: fix/region-approval).
 */

import type { Db } from "mongodb";
import type { PoliticalMetricsDoc } from "@/lib/db/types/politicalMetrics";
import type { State } from "@/lib/db/types/state";
import type { CountryId } from "@/lib/constants/countries";
import { BASE_APPROVAL } from "@/lib/utils/governmentApproval";
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
 *
 * Narrows to `CountryId`, not `PoliticalMetricsCountryId`: every member of the
 * set is a real country, but the narrow union means "has authored baseline
 * anchors" and is still just the four playables. Asserting it here would let
 * anchor-only lookups compile against countries that have none.
 */
export function isPoliticalApprovalCountry(
  countryId: string | null | undefined
): countryId is CountryId {
  return countryId != null && BOARD_COUNTRIES.has(countryId);
}

export interface PoliticalApprovalBases {
  /** stateId → base approval (BASE_APPROVAL + component, clamped 0–100, rounded 0.1). */
  byRegion: Map<string, number>;
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
  countryId: CountryId
): Promise<PoliticalApprovalBases | null> {
  // The world's preset picks which era's intercept to score against — a
  // non-playable's board sits at a different level per era, so the wrong
  // intercept would lurch its approval.
  const [gameState, docs, states] = await Promise.all([
    db
      .collection<{ _id: string; preset?: string }>("gameState")
      .findOne({ _id: "current" }, { projection: { preset: 1 } }),
    db.collection<PoliticalMetricsDoc>("politicalMetrics").find({ countryId }).toArray(),
    db
      .collection<State>("states")
      .find(
        { countryId },
        { projection: { _id: 1, population: 1, cachedEconomicLean: 1, cachedSocialLean: 1 } }
      )
      .toArray(),
  ]);
  if (docs.length === 0) return null;

  const stateById = new Map(states.map((s) => [s._id, s]));
  const byRegion = new Map<string, number>();
  let weighted = 0;
  let totalPop = 0;
  for (const doc of docs) {
    const state = stateById.get(doc._id);
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
