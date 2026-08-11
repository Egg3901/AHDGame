import type { Db } from "mongodb";
import type { GameState } from "@/lib/db/types/gameState";
import { resolveGameYear } from "./era";
import { getStartingYearForPreset } from "@/lib/constants/turnTime";

export interface EraContext {
  /** Live in-game year — non-null ONLY when the era system is enabled. */
  year: number | null;
  preset: string | null;
  /** World starting year (frozen) — anchors the medianIncome band; null flag-off. */
  startingYear: number | null;
  /**
   * Per-country realized-growth index for the medianIncome band, persisted each
   * turn by computeNationalMetrics. Null while the flag is off or before the
   * first flag-on turn (scoring falls back to the full legacy band).
   */
  incomeBandIndexByCountry: Partial<Record<string, number>> | null;
}

/**
 * The live-clock context for a gameState-shaped doc, as the vote path wants it.
 *
 * Pure counterpart to {@link getEraContext} for callers that have already read
 * `gameState` for their own reasons and must not pay a second round-trip —
 * the election engines read it per tally, so an extra query there is a real
 * cost. Encapsulates the same `eraSystemEnabled` gate, so a flag-off world
 * yields `year: null` and every downstream path keeps legacy behavior.
 */
export function eraYearContextFromGameState(
  gs:
    | {
        currentYear?: number;
        currentTurn?: number;
        startingYear?: number;
        eraSystemEnabled?: boolean;
      }
    | null
    | undefined
): { year: number | null; startingYear: number | null } {
  if (!gs?.eraSystemEnabled) return { year: null, startingYear: null };
  return { year: resolveGameYear(gs), startingYear: gs.startingYear ?? null };
}

/**
 * One-stop era context for server scoring paths. Encapsulates the flag gate:
 * callers pass `year` straight into scoreMetric/evaluateModifiers and get
 * legacy behavior automatically while the flag is off.
 */
export async function getEraContext(db: Db): Promise<EraContext> {
  const gs = await db.collection<GameState>("gameState").findOne(
    { _id: "current" },
    {
      projection: {
        preset: 1,
        currentYear: 1,
        currentTurn: 1,
        startingYear: 1,
        eraSystemEnabled: 1,
        incomeBandIndexByCountry: 1,
      },
    }
  );
  const preset = gs?.preset ?? null;
  if (!gs?.eraSystemEnabled) {
    return { year: null, preset, startingYear: null, incomeBandIndexByCountry: null };
  }
  return {
    year: resolveGameYear(gs),
    preset,
    startingYear: gs.startingYear ?? null,
    incomeBandIndexByCountry: gs.incomeBandIndexByCountry ?? null,
  };
}

/**
 * The year seed-time code should use.
 *
 * Prefers the world's live in-game year — a reseed into an existing world must
 * use where that world actually IS — and falls back to the preset's starting
 * year. The fallback is load-bearing, not defensive: during a fresh bootstrap
 * both `runSeed` and `seedPoliticalMetrics` run BEFORE `initializeGameState`,
 * so there is no gameState doc to read and the preset is the only available
 * source for the year. Passing the preset is therefore required, not optional;
 * a hardcoded default here would silently seed 1953 values into every world
 * regardless of era.
 *
 * Seed-time callers use this rather than `getEraContext` because they must
 * resolve a year even while `eraSystemEnabled` is off: the political pipeline
 * is year-driven unconditionally, and a null year there would mean "no
 * baselines", not "legacy behavior".
 */
export async function resolveWorldSeedYear(db: Db, preset: string): Promise<number> {
  const gs = await db
    .collection<GameState>("gameState")
    .findOne(
      { _id: "current" },
      { projection: { currentYear: 1, currentTurn: 1, startingYear: 1 } }
    );
  return (gs ? resolveGameYear(gs) : null) ?? getStartingYearForPreset(preset);
}
