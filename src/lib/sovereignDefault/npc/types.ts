/**
 * NPC sovereign-default scoring types.
 */

import type { ObjectId } from "mongodb";
import type { SovereignResolutionChoice } from "@/lib/db/types/budget";
import type { NpcGovernmentType, NpcIdeology } from "./npcConstants";

export interface NpcExecutiveProfile {
  /** Character/NPP _id of the country's executive; null when no leader. */
  characterId: ObjectId | null;
  ideology: NpcIdeology;
  governmentType: NpcGovernmentType;
  /**
   * Where the leader was found. "player" = a Character with a userId
   * controls the country (auto-propose disabled, player uses the UI).
   * "npp" = an NPC politician holds the office (auto-propose enabled).
   * "none" = the office is vacant (treat as NPC for auto-propose so the
   * country isn't stuck in `crisisPending` until the timer expires).
   */
  kind: "player" | "npp" | "none";
}

export interface NpcCountryState {
  debtToGdp: number;
  /** Inflation as percentage points (e.g. 3.94 for 3.94%) */
  inflationRatePct: number;
  /** Fraction depreciated over the FX lookback window (0..1) */
  fxDepreciationFraction: number;
  hasReserveCurrency: boolean;
  /** null when never defaulted */
  turnsSinceLastDefault: number | null;
  /** Pre-computed: monetize unavailable when current inflation > 8% */
  inflationGateExceeded: boolean;
}

export interface NpcOptionScore {
  option: SovereignResolutionChoice;
  score: number;
}
