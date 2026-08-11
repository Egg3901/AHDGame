/**
 * Local-layer sector margin penalty (design 5.3).
 *
 * Applied per-turn to corps domiciled in the defaulting country. Returns 0 for
 * foreign corps (which the global-contagion layer handles), monetize resolution
 * (inflation pipeline handles), or rows outside the 72-turn full+decay window.
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
} from "../constants";

export interface LocalPenaltyInputs {
  corpCountryId: string;
  defaultingCountryCode: string;
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

export function computeLocalSectorMarginPenalty(inputs: LocalPenaltyInputs): number {
  if (inputs.corpCountryId !== inputs.defaultingCountryCode) return 0;
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

  return basePenalty * sectorMultiplier * decayFactor;
}
