/**
 * Era spine — the single source of truth for "what era is it".
 *
 * The player-facing era is a DECADE bucket derived from the LIVE in-game
 * year, never from the immutable seed `preset` string. A 1991-seeded game
 * that has reached 2008 is in the 2000s, same as a 2019-seeded game rolled
 * back to 2008 would be. (Numeric calibration drifts continuously by year —
 * see expectations.ts; the decade Era is identity: marker, news, labels.)
 */
import { TURNS_PER_YEAR } from "@/lib/constants/turnTime";

export interface Era {
  /** Stable id, e.g. "2000s". Stamped to gameState.currentEraId by the crossing phase. */
  id: string;
  label: string;
  startYear: number;
  endYear: number;
}

/** Supported year domain. Presets 1953/1979/1991/2019 all fall inside. */
export const ERA_DOMAIN = { min: 1950, max: 2049 } as const;

export function eraFromYear(year: number): Era {
  const clamped = Math.min(ERA_DOMAIN.max, Math.max(ERA_DOMAIN.min, year));
  const startYear = Math.floor(clamped / 10) * 10;
  const label = `${startYear}s`;
  return { id: label, label, startYear, endYear: startYear + 9 };
}

/**
 * Live in-game year from a gameState-shaped doc. Prefers the maintained
 * `currentYear`; falls back to deriving from turn + startingYear (legacy
 * rows). Returns null when neither is available — callers must treat null
 * as "era-awareness unavailable" and keep legacy behavior.
 */
export function resolveGameYear(gs: {
  currentYear?: number;
  currentTurn?: number;
  startingYear?: number;
}): number | null {
  if (Number.isFinite(gs.currentYear)) return gs.currentYear as number;
  if (Number.isFinite(gs.currentTurn) && Number.isFinite(gs.startingYear)) {
    return (
      (gs.startingYear as number) + Math.floor(((gs.currentTurn as number) - 1) / TURNS_PER_YEAR)
    );
  }
  return null;
}
