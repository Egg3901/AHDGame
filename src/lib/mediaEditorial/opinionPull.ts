/**
 * Newsroom slant pulls public opinion. Each turn a state's electorate position
 * on each axis moves a small step toward the state's reach-weighted newsroom
 * slant (see `slant.ts`). The step is added to the existing per-turn
 * demographics drift in `demographicEffects.ts`, so legislation drift and
 * baseline mean reversion keep working exactly as before and polling and
 * elections keep reading the same electorate fields.
 */
import type { Db } from "mongodb";
import { reachWeightedSlant, type Newsroom, type StateSlant } from "./slant";
import { normalizeEditorialPosition, type EditorialPosition } from "./rules";

/**
 * Most an axis can move from media in a window of {@link MEDIA_PULL_WINDOW_TURNS}
 * turns, at full saturation and the largest possible distance.
 */
export const MEDIA_PULL_MAX_POINTS_PER_WINDOW = 0.5;
/** Length of the window above: 72 turns, three game days. */
export const MEDIA_PULL_WINDOW_TURNS = 72;
/** Hard per-turn ceiling on the step, in axis points. About 0.0069. */
export const MEDIA_PULL_MAX_STEP_PER_TURN =
  MEDIA_PULL_MAX_POINTS_PER_WINDOW / MEDIA_PULL_WINDOW_TURNS;
/** Full width of an axis (-5 to +5), the largest possible distance to the slant. */
export const MEDIA_PULL_AXIS_SPAN = 10;
/**
 * Fraction of the remaining distance closed per turn at full saturation.
 * Chosen so the step at maximum distance equals the per-turn ceiling. Far
 * below 1, so the step can never carry opinion past the slant.
 */
export const MEDIA_PULL_RATE = MEDIA_PULL_MAX_STEP_PER_TURN / MEDIA_PULL_AXIS_SPAN;
/** Game turns in one game day, for player-facing rates. */
export const MEDIA_PULL_TURNS_PER_DAY = 24;

export interface MediaPull {
  economic: number;
  social: number;
}

/**
 * One turn's step on a single axis. Proportional to the distance and to the
 * saturation, capped at the per-turn ceiling and never larger than the
 * distance itself. Zero when there is no slant or no distance.
 */
export function mediaPullStep(current: number, target: number, saturation: number): number {
  if (!Number.isFinite(current) || !Number.isFinite(target)) return 0;
  const strength = Math.min(1, Math.max(0, Number.isFinite(saturation) ? saturation : 0));
  const gap = target - current;
  if (gap === 0 || strength === 0) return 0;
  const raw = MEDIA_PULL_RATE * strength * gap;
  const magnitude = Math.min(Math.abs(raw), MEDIA_PULL_MAX_STEP_PER_TURN, Math.abs(gap));
  return Math.sign(gap) * magnitude;
}

/** Per-axis step toward a state's slant. Null slant means no pull. */
export function mediaPullForState(
  lean: { economic: number; social: number },
  slant: StateSlant | null
): MediaPull {
  if (!slant) return { economic: 0, social: 0 };
  return {
    economic: mediaPullStep(lean.economic, slant.economic, slant.strength),
    social: mediaPullStep(lean.social, slant.social, slant.strength),
  };
}

/**
 * Slants for every state with media sectors, in two reads total (sectors, then
 * the owning corporations), regardless of state count.
 */
export async function loadAllStateSlants(db: Db): Promise<Map<string, StateSlant>> {
  const sectors = await db
    .collection("corporateSectors")
    .find({ sectorType: "media", mothballed: { $ne: true } })
    .project<{
      corporationId: unknown;
      stateId?: string;
      revenue?: number;
      realizedRevenue?: number;
    }>({ corporationId: 1, stateId: 1, revenue: 1, realizedRevenue: 1 })
    .toArray();
  const result = new Map<string, StateSlant>();
  if (sectors.length === 0) return result;
  const corps = await db
    .collection("corporations")
    .find({ _id: { $in: [...new Set(sectors.map((s) => s.corporationId))] as never[] } })
    .project<{ _id: unknown; editorialStance?: EditorialPosition }>({ editorialStance: 1 })
    .toArray();
  const stanceById = new Map(corps.map((corp) => [String(corp._id), corp.editorialStance]));
  const byState = new Map<string, Newsroom[]>();
  for (const sector of sectors) {
    if (!sector.stateId) continue;
    const list = byState.get(sector.stateId) ?? [];
    list.push({
      stance: normalizeEditorialPosition(stanceById.get(String(sector.corporationId))),
      weight: sector.realizedRevenue ?? sector.revenue ?? 0,
    });
    byState.set(sector.stateId, list);
  }
  for (const [stateId, newsrooms] of byState) {
    const slant = reachWeightedSlant(newsrooms);
    if (slant) result.set(stateId, slant);
  }
  return result;
}

/** Whole-number-friendly points per game day from a per-turn step. */
export function mediaPullPerDay(stepPerTurn: number): number {
  return Math.abs(stepPerTurn) * MEDIA_PULL_TURNS_PER_DAY;
}
