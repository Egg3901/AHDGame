/**
 * Translate a delta expressed in a LEGACY metric's own units into a delta on
 * the political board's 0-100 scale.
 *
 * The 22 non-playable countries still run the legacy law catalog — ~212 of its
 * types have a political-category `effectTarget` — while their metrics now live
 * on the board. The same is true of every other mechanic still authored against
 * legacy paths: SOE public-service mandates, sovereign-default trust hits, civil
 * unrest. Without this bridge, retiring `stateMetrics` leaves all of them
 * writing to nothing.
 *
 * SCALE ONLY — THE CALLER PICKS THE MODE. This function answers "how many board
 * points is this worth", not "where should it be recorded", and that second
 * question has two genuinely different right answers:
 *
 *   - RESIDUAL for enacted LAW. The dynamics phase drifts each value toward its
 *     composed target every turn, so a one-off bump to the VALUE would be
 *     pulled straight back out and the law would flicker and vanish. Laws move
 *     the EQUILIBRIUM for playables (via `lawTargets`), and `residuals` is the
 *     documented hook for everything else that does the same.
 *   - VALUE for EVENTS and ONGOING PRESSURE. A default damages trust and trust
 *     recovers; an SOE's mandate contribution is re-applied every turn and
 *     should relax once the state sells the sector. Both want exactly the decay
 *     the dynamics phase provides.
 *
 * Getting this backwards is silent: a law recorded as a value fades out over a
 * few turns, and an event recorded as a residual permanently redefines the
 * country. Each caller states its choice at the `applyBoardDelta` call.
 *
 * Neither mode is the Bridge B macro term, which must never be persisted here —
 * that one is transient and recomputed from scratch every turn.
 *
 * THE CONVERSION normalizes the legacy delta over `metricQualityRange` — the
 * same span the derivation uses in both directions — and flips sign for
 * lower-is-better metrics, so a law that cuts `crimeRate` RAISES `order.safety`.
 *
 * CAPPED, because the span can be far narrower than the metric's own scale.
 * `powerGridReliability` is stored as a 0-100 uptime percent but its realistic
 * quality span is [97, 99.9] — 2.9 points wide. Normalizing over that span is
 * a 34.5x amplifier, so the -4.5 per turn a "grid reliability collapse" crisis
 * was authored to apply arrived as -155 board points, floored
 * `infrastructure.utilities` to 0 on the first tick and held it there for as
 * long as the crisis ran. Every authored legacy delta in the game is written
 * against the metric's OWN scale, not against its quality band, so any metric
 * with a narrow band turns a routine effect into an annihilating one.
 *
 * BOARD_DELTA_CAP matches ENGINE_BOUND and MACRO_BOUND: one channel BENDS a
 * family, it never overrules it in a single write. A shock big enough to hit
 * the cap still lands at full strength every turn it is applied, so a sustained
 * crisis still walks the family down; it just cannot teleport it to the floor.
 */
import { getMetricDefinition } from "@/lib/constants/metricDefinitions";
import { metricQualityRange } from "@/lib/corporations/sectorMetricMarginProfiles";
import type { MetricCategoryId } from "@/lib/db/types";
import { MIN_CRISIS_DURATION_TURNS } from "@/lib/crises/crisisDuration";
import { ADAPTER_TIER1 } from "./marginAdapter";

/** Largest board movement one legacy-unit conversion may produce, either way. */
export const BOARD_DELTA_CAP = 12;

/**
 * The same allowance, spread over a full-length crisis, for effects that RECUR
 * every turn.
 *
 * A per-write cap alone does not bound a per-turn effect: a "grid reliability
 * collapse" tick still arrived at -12 board points on every one of the crisis's
 * 24 turns, which annihilates the family just as thoroughly as one -155 write
 * did, only slower. The rule that makes both cases sane is the same one:
 * ONE CRISIS BENDS A FAMILY BY AT MOST ONE CAP, whether it spends that in a
 * single shock or over its whole life. Callers applying a recurring effect pass
 * this instead of `BOARD_DELTA_CAP`.
 */
export const BOARD_TICK_DELTA_CAP = BOARD_DELTA_CAP / MIN_CRISIS_DURATION_TURNS;

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

export interface BoardScoreDelta {
  /** Political family the legacy path maps onto. */
  familyId: string;
  /** Board points to add, on the 0-100 scale. Signed; caller picks the mode. */
  scoreDelta: number;
}

/**
 * The board equivalent of one legacy metric delta, or null when the legacy path
 * has no `ADAPTER_TIER1` row.
 *
 * Null is a real answer, not a failure to handle: that map is the reviewed
 * legacy↔family correspondence, and inventing a mapping for a path it omits
 * would fabricate a policy channel nobody designed.
 */
export function boardDeltaForLegacyEffect(
  category: string,
  metricId: string,
  legacyDelta: number,
  /** Opt-in era: score the delta against the metric's band FOR THAT YEAR. */
  era?: { countryId?: string | null; year?: number | null },
  /** Cap for this write. Recurring effects pass `BOARD_TICK_DELTA_CAP`. */
  cap: number = BOARD_DELTA_CAP
): BoardScoreDelta | null {
  if (!Number.isFinite(legacyDelta) || legacyDelta === 0) return null;
  const familyId = ADAPTER_TIER1[`${category}.${metricId}`];
  if (!familyId) return null;

  const definition = getMetricDefinition(category as MetricCategoryId, metricId);
  if (!definition) return null;
  const { min, max } = metricQualityRange(definition, metricId, era);
  if (!(max > min)) return null;

  const magnitude = (legacyDelta / (max - min)) * 100;
  const signed = definition.isHigherBetter ? magnitude : -magnitude;
  const scoreDelta = clamp(signed, -cap, cap);
  if (!Number.isFinite(scoreDelta) || scoreDelta === 0) return null;
  return { familyId, scoreDelta };
}
