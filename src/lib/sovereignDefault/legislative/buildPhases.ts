/**
 * Build the initial legislative-phase array when the executive proposes a
 * sovereign-crisis resolution. Starts with the lower chamber's 24h voting
 * window; the upper chamber phase is appended in-place by the per-turn
 * processor when (if) the lower chamber passes.
 */

import { getCountryConfig, type CountryId } from "@/lib/constants/countries";
import {
  LEGISLATIVE_VOTE_HOURS_PER_CHAMBER,
  LEGISLATIVE_VOTE_TURNS_PER_CHAMBER,
} from "../constants";
import type { LegislativePhase } from "./types";

const MS_PER_HOUR = 60 * 60 * 1000;

export function buildInitialLegislativePhases(
  countryId: CountryId,
  realtimeMs: number,
  currentTurn: number
): LegislativePhase[] {
  const config = getCountryConfig(countryId);
  const lowerKey = config.legislature.lowerChamber.key;
  return [
    {
      chamberKey: lowerKey,
      startedAtRealtimeMs: realtimeMs,
      endsAtRealtimeMs: realtimeMs + LEGISLATIVE_VOTE_HOURS_PER_CHAMBER * MS_PER_HOUR,
      endsOnTurn: currentTurn + LEGISLATIVE_VOTE_TURNS_PER_CHAMBER,
      votesFor: 0,
      votesAgainst: 0,
      votes: {},
      outcome: "pending",
    },
  ];
}

/**
 * Build the next phase (upper chamber) after the lower chamber passes.
 * Returns null when the country has no upper chamber (so the design's
 * unicameral / money-bill-primacy fallback path can short-circuit). Phase 9b
 * always appends if the upper chamber exists; Phase 10 calibration can add
 * the money-bill-primacy override (skipping upper).
 */
export function buildUpperChamberPhase(
  countryId: CountryId,
  realtimeMs: number,
  currentTurn: number
): LegislativePhase | null {
  const config = getCountryConfig(countryId);
  const upperKey = config.legislature.upperChamber?.key;
  if (!upperKey) return null;
  return {
    chamberKey: upperKey,
    startedAtRealtimeMs: realtimeMs,
    endsAtRealtimeMs: realtimeMs + LEGISLATIVE_VOTE_HOURS_PER_CHAMBER * MS_PER_HOUR,
    endsOnTurn: currentTurn + LEGISLATIVE_VOTE_TURNS_PER_CHAMBER,
    votesFor: 0,
    votesAgainst: 0,
    votes: {},
    outcome: "pending",
  };
}
