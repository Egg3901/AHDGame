/**
 * Layer-1 demographic POSITIONS as a continuous function of the live in-game
 * year, rather than of the frozen seed preset.
 *
 * This is the position half of the era-continuity program (the census-marginal
 * half interpolates separately). It resolves a full position table at each
 * bracketing anchor and blends those, per the program's standing rule: never
 * lerp a sparse override table, lerp the fully-resolved substrate.
 *
 * Two corrections to naive interpolation live here, both of them load-bearing.
 *
 * 1. CARRY OVERRIDES FORWARD, NEVER DECAY THEM
 * --------------------------------------------
 * `STATE_POSITION_OVERRIDES` authors a full 51-state regional map for 1953 and
 * again for 1979, and nothing after. Blending the raw tables would read those
 * missing anchors as "no regional character": every state's lean would converge
 * on the single national number by 1991 and stay there. That is not a subtle
 * calibration drift — it flattens the entire electoral geography of the United
 * States, and it runs the Southern realignment BACKWARDS (Alabama's authored
 * `race.white` economic lean is +2.5 in 1979 against a +1.0 national base, so
 * decay pulls it left).
 *
 * A missing later anchor means "unchanged", never "reverted to the mean". Past
 * the last authored anchor the override is carried forward as a DELTA against
 * the national base it was authored against, then re-applied to the current
 * era's national base. Alabama stays 1.0 to the right of the nation
 * permanently, while the national trend itself keeps moving. Authoring real
 * 1991+ overrides later strictly improves on this; it is not a prerequisite.
 *
 * Within the authored range the tables are used as authored — the 1953 values
 * in particular are absolute registration anchors, not deltas (see the
 * comment on `STATE_POSITION_OVERRIDES["1953"]`), so the delta re-basing only
 * ever applies FORWARD of the last authored anchor.
 *
 * 2. DE-DUPLICATE WHAT THE CHECKPOINTS ALREADY OWN
 * ------------------------------------------------
 * The anchors are authored from real election results, so a later anchor
 * already contains the history that `eraCheckpoints.ts` applies as a live
 * durable pull. Interpolating the anchors as a baseline while the overlay also
 * runs counts the same realignment twice. `bakedCheckpointBucketShifts`
 * subtracts, at each anchor, exactly what the checkpoints had delivered by that
 * anchor's year — so `baseline + overlay == the authored anchor` at every
 * anchor, and moves smoothly between them. See `checkpointBakedShifts.ts` for
 * why that subtraction is safe to apply unconditionally under the 1953 gate.
 *
 * The result is a baseline the durable overlay sits on top of cleanly:
 * interpolation supplies the trend nobody owns, checkpoints and legislation
 * supply the movement somebody does, and the two never fight.
 */
import type { EraId } from "./presetSelector";
import {
  getEraPositions,
  hasStateOverrides,
  STATE_OVERRIDE_ANCHOR_ERAS,
  type DemographicPosition,
  type DemographicTurnoutRates,
} from "./demographicCategories";
import { ERA_ANCHOR_YEARS, lerpNumericTree, resolveEraBlend } from "./eraInterpolation";
import {
  bakedCheckpointBucketShifts,
  type BakedAxis,
} from "@/lib/demographics/checkpointBakedShifts";

export type PositionTable = Record<
  keyof DemographicTurnoutRates,
  Record<string, DemographicPosition>
>;

export interface EraPositionYearOptions {
  /**
   * The world's `gameState.startingYear`. Gates checkpoint de-duplication to
   * the same worlds that actually run checkpoints — see
   * `checkpointBakedShifts.ts`. Omit/null for "this world runs no checkpoints".
   */
  startingYear?: number | null;
}

/** Only the two LEAN axes live on a position table; `turnout` is a separate substrate. */
type LeanAxis = Extract<BakedAxis, "economicLean" | "socialLean">;
const AXES: readonly LeanAxis[] = ["economicLean", "socialLean"];

function clonePositions(src: PositionTable): PositionTable {
  const out = {} as PositionTable;
  for (const [dim, buckets] of Object.entries(src)) {
    const d: Record<string, DemographicPosition> = {};
    for (const [key, pos] of Object.entries(buckets)) {
      d[key] = { economicLean: pos.economicLean, socialLean: pos.socialLean };
    }
    out[dim as keyof DemographicTurnoutRates] = d;
  }
  return out;
}

/** The state's authored distance from the national base at one override anchor. */
type PositionGap = Record<string, Record<string, { economicLean: number; socialLean: number }>>;

/**
 * A state's REGIONAL CHARACTER at an override anchor: how far its authored
 * positions sit from that same era's national base.
 *
 * Expressing the override as a gap rather than an absolute is what lets it
 * survive a moving national baseline. An anchor that authors nothing for this
 * state has no regional character there and yields an empty gap, which reads
 * as zero — correct for a state that simply is not in the 1953 map.
 */
function stateGapAtAnchor(era: EraId, stateId: string): PositionGap {
  if (!hasStateOverrides(era, stateId)) return {};
  const base = getEraPositions(era);
  const authored = getEraPositions(era, stateId);
  const gap: PositionGap = {};
  for (const dim of Object.keys(authored)) {
    const dimGap: Record<string, { economicLean: number; socialLean: number }> = {};
    for (const key of Object.keys(authored[dim as keyof typeof authored])) {
      const a = authored[dim as keyof typeof authored][key];
      const b = base[dim as keyof typeof base]?.[key];
      if (!a || !b) continue;
      const dEcon = a.economicLean - b.economicLean;
      const dSoc = a.socialLean - b.socialLean;
      if (dEcon === 0 && dSoc === 0) continue;
      dimGap[key] = { economicLean: dEcon, socialLean: dSoc };
    }
    if (Object.keys(dimGap).length > 0) gap[dim] = dimGap;
  }
  return gap;
}

/**
 * The state's regional character at `year`, blended across the anchors that
 * actually author a state map.
 *
 * `STATE_POSITION_OVERRIDES` is authored at its own sparse set of anchors
 * (1953, 1979, 1991, 2019), which is NOT the full era anchor set. Blending on
 * that sparse set is what makes 1999 and 2007 sit between the 1991 and 2019
 * maps instead of freezing on 1991 — an earlier version of this module picked
 * the nearest anchor at-or-below and produced exactly that freeze, which held
 * Appalachia at its 1992 position for eight years and then jumped.
 *
 * Past the last authored anchor the final gap holds: a missing later anchor
 * means "unchanged", never "reverted to the national mean".
 */
function stateGapForYear(stateId: string, year: number): PositionGap {
  const authoredEras = STATE_OVERRIDE_ANCHOR_ERAS.filter((e) => hasStateOverrides(e, stateId));
  if (authoredEras.length === 0) return {};
  const { lo, hi, t } = resolveEraBlend(year, authoredEras);
  const gapLo = stateGapAtAnchor(lo, stateId);
  if (t === 0 || lo === hi) return gapLo;
  const gapHi = stateGapAtAnchor(hi, stateId);

  const out: PositionGap = {};
  for (const dim of new Set([...Object.keys(gapLo), ...Object.keys(gapHi)])) {
    const dimOut: Record<string, { economicLean: number; socialLean: number }> = {};
    for (const key of new Set([
      ...Object.keys(gapLo[dim] ?? {}),
      ...Object.keys(gapHi[dim] ?? {}),
    ])) {
      const a = gapLo[dim]?.[key] ?? { economicLean: 0, socialLean: 0 };
      const b = gapHi[dim]?.[key] ?? { economicLean: 0, socialLean: 0 };
      dimOut[key] = {
        economicLean: a.economicLean + (b.economicLean - a.economicLean) * t,
        socialLean: a.socialLean + (b.socialLean - a.socialLean) * t,
      };
    }
    out[dim] = dimOut;
  }
  return out;
}

/**
 * The fully-resolved position table at one anchor era. Thin wrapper over
 * {@link getEraPositionsForYear} at that anchor's year, kept because tests and
 * the substrate resolver both read anchor-by-anchor.
 */
export function resolveEraPositionsAtAnchor(
  era: EraId,
  stateId: string | undefined,
  opts: EraPositionYearOptions = {}
): PositionTable {
  return getEraPositionsForYear(ERA_ANCHOR_YEARS[era], stateId, opts);
}

/**
 * Layer-1 positions for `stateId` at the live in-game `year`.
 *
 * At an anchor year this returns that anchor's resolved table exactly, so a
 * world seeded at an anchor is a no-op on day one. Between anchors it blends
 * the two resolved tables.
 *
 * Deliberately NOT clamped to the ±5 lean axis: the checkpoint subtraction can
 * legitimately push a baseline past the axis edge, and the overlay brings it
 * back. `applyPositionOverlay` in `granularElectorate.ts` clamps the sum, which
 * is the only place clamping is meaningful.
 */
export function getEraPositionsForYear(
  year: number,
  stateId?: string,
  opts: EraPositionYearOptions = {}
): PositionTable {
  // 1. National baseline, blended across the full era anchor set.
  const { lo, hi, t } = resolveEraBlend(year);
  const nationalLo = getEraPositions(lo);
  const resolved =
    t === 0 || lo === hi
      ? clonePositions(nationalLo)
      : lerpNumericTree(clonePositions(nationalLo), clonePositions(getEraPositions(hi)), t);
  if (!stateId) return resolved;

  // 2. Regional character, blended across the anchors that author a state map
  //    — a different, sparser set. Added on top so the state keeps its distance
  //    from the nation while the nation itself keeps moving.
  const gap = stateGapForYear(stateId, year);
  for (const [dim, buckets] of Object.entries(gap)) {
    const target = resolved[dim as keyof DemographicTurnoutRates];
    if (!target) continue;
    for (const [key, delta] of Object.entries(buckets)) {
      const cur = target[key];
      if (!cur) continue;
      cur.economicLean += delta.economicLean;
      cur.socialLean += delta.socialLean;
    }
  }

  // 3. Remove what the durable overlay will re-add, so the two never
  //    double-count. Uses the LIVE year, not an anchor year, so a world sitting
  //    mid-checkpoint subtracts only what has actually been delivered.
  for (const axis of AXES) {
    const baked = bakedCheckpointBucketShifts(stateId, axis, year, opts.startingYear);
    for (const [bucketKey, delta] of Object.entries(baked)) {
      if (delta === 0) continue;
      const sep = bucketKey.indexOf(":");
      const dim = bucketKey.slice(0, sep) as keyof DemographicTurnoutRates;
      const key = bucketKey.slice(sep + 1);
      const cur = resolved[dim]?.[key];
      if (!cur) continue;
      cur[axis] -= delta;
    }
  }
  // 4. Snap out float residue. The gap re-add ((state − national) + national)
  //    and the checkpoint subtract/re-add pair are identities in real
  //    arithmetic but not in floats: an authored −0.4 comes back as
  //    −0.3999999999999999, which is enough to flip a cell across the
  //    coalesce/prune quantization boundary downstream and break the
  //    "anchors reproduce the authored table exactly" contract. Authored
  //    values live on a 0.1 grid, so a 1e-9 snap is far below any real
  //    interpolation signal.
  for (const buckets of Object.values(resolved)) {
    for (const cur of Object.values(buckets)) {
      cur.economicLean = Math.round(cur.economicLean * 1e9) / 1e9;
      cur.socialLean = Math.round(cur.socialLean * 1e9) / 1e9;
    }
  }
  return resolved;
}
