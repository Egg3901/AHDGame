/**
 * Global-contagion-layer sector margin penalty (design 5.3).
 *
 * Foreign corps absorb a partial penalty scaled by the defaulter's GDP share
 * times GLOBAL_CONTAGION_MULTIPLIER. Same per-sector multiplier and decay
 * schedule as the local layer.
 */

import type { CorporationType } from "@/lib/constants/corporations";
import type { SovereignResolutionChoice } from "@/lib/db/types/budget";
import {
  DEFAULT_MARGIN_PENALTY_REPUDIATE,
  DEFAULT_MARGIN_PENALTY_RESTRUCTURE,
  DEFAULT_MARGIN_PENALTY_BAILOUT,
  DEFAULT_MARGIN_PENALTY_MONETIZE,
  DEFAULT_MARGIN_FULL_PENALTY_TURNS,
  DEFAULT_MARGIN_DECAY_TURNS,
  DEFAULT_MARGIN_SECTOR_MULTIPLIERS,
  GLOBAL_CONTAGION_MULTIPLIER,
} from "../constants";

export interface GlobalContagionInputs {
  corpCountryId: string;
  defaultingCountryCode: string;
  defaultingCountryGdp: number;
  globalGdp: number;
  resolutionType: SovereignResolutionChoice;
  corpType: CorporationType;
  currentTurn: number;
  lastDefaultTurn: number | null;
}

const TOTAL_WINDOW_TURNS = DEFAULT_MARGIN_FULL_PENALTY_TURNS + DEFAULT_MARGIN_DECAY_TURNS;

function basePenaltyFor(resolution: SovereignResolutionChoice): number {
  switch (resolution) {
    case "repudiate":
      return DEFAULT_MARGIN_PENALTY_REPUDIATE;
    case "restructure":
      return DEFAULT_MARGIN_PENALTY_RESTRUCTURE;
    case "bailout":
      return DEFAULT_MARGIN_PENALTY_BAILOUT;
    case "monetize":
      return DEFAULT_MARGIN_PENALTY_MONETIZE;
  }
}

export function computeGlobalContagionSectorMarginPenalty(inputs: GlobalContagionInputs): number {
  if (inputs.corpCountryId === inputs.defaultingCountryCode) return 0;
  if (inputs.globalGdp <= 0) return 0;
  if (inputs.lastDefaultTurn === null) return 0;
  const turnsSinceDefault = inputs.currentTurn - inputs.lastDefaultTurn;
  if (turnsSinceDefault < 0) return 0;
  if (turnsSinceDefault >= TOTAL_WINDOW_TURNS) return 0;

  const basePenalty = basePenaltyFor(inputs.resolutionType);
  if (basePenalty === 0) return 0;

  const sectorMultiplier = DEFAULT_MARGIN_SECTOR_MULTIPLIERS[inputs.corpType];
  const decayFactor =
    turnsSinceDefault < DEFAULT_MARGIN_FULL_PENALTY_TURNS
      ? 1.0
      : 1.0 - (turnsSinceDefault - DEFAULT_MARGIN_FULL_PENALTY_TURNS) / DEFAULT_MARGIN_DECAY_TURNS;
  const gdpShare = inputs.defaultingCountryGdp / inputs.globalGdp;

  return basePenalty * sectorMultiplier * decayFactor * gdpShare * GLOBAL_CONTAGION_MULTIPLIER;
}
