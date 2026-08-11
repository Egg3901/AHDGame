import type { AlignmentPoleId } from "@/lib/constants/alignmentEras";

/**
 * Bloc stress — the price of holding a bloc together.
 *
 * Every other alignment mechanic is per-nation: shares move, a nation joins, a
 * nation walks out. Nothing modelled the BLOC as a thing that can be strained,
 * so an alliance could grab half the map and defend all of it exactly as well as
 * a compact one. Expansion was free.
 *
 * Stress is a 0-1 gauge over a bloc's own members, built from three things that
 * really do stretch an alliance:
 *
 *  - **Contested members.** A member the rival poles are actively pulling at
 *    costs attention. A member nobody is fighting for costs nothing.
 *  - **Members heading for the door.** `wantsOutSinceTurn` is already the
 *    engine's sustained-run signal that a member's share has fallen to the leave
 *    threshold. A bloc arguing with its own members is not projecting outward.
 *  - **Recent accessions.** A bloc that just took on three new members is
 *    digesting them. This decays: it is a transition cost, not a permanent tax
 *    on being large.
 *
 * Note what is deliberately NOT an input: raw member count. Size alone is not
 * strain — a large bloc of settled, uncontested members is the historically
 * strong case (NATO through the 1960s), and taxing size directly would just
 * make expansion bad rather than costly.
 *
 * The effect is a dampener on the bloc's own plays, so an overextended alliance
 * pushes less hard everywhere. It is self-correcting: stress falls as members
 * settle, and a bloc that stops overreaching recovers without spending anything.
 */

/** Weights sum to 1, so stress is a clean 0-1 gauge. */
const CONTESTED_WEIGHT = 0.45;
const WANTS_OUT_WEIGHT = 0.35;
const DIGESTION_WEIGHT = 0.2;

/**
 * A member is contested when a RIVAL pole holds at least this much of it.
 *
 * This was originally "our share is below the locked gate (85)", which was
 * miscalibrated against the game's own seeds: the 1953 rosters hold members at
 * 64-88, so most of both blocs read as contested on day one and every world
 * started Strained with no player having done anything. Worse, it was
 * asymmetric — NATO's authored shares are lower than the Warsaw Pact's, so the
 * West began permanently docked relative to the East.
 *
 * A rival's share is the honest measure and matches this module's own claim
 * that "a member nobody is fighting for costs nothing". The threshold reuses
 * `crisis.ts`'s tug-of-war convention and its reasoning: two poles at 4 and 3
 * are not fighting over a country, they are ignoring it.
 */
const CONTESTED_RIVAL_MIN = 25;

/** Turns an accession keeps counting as digestion. A quarter game-year. */
export const DIGESTION_WINDOW_TURNS = 12;

/**
 * Most a fully-stressed bloc loses from its plays. Not 1: a bloc under maximum
 * strain is impaired, not inert, and a mechanic that can zero a player's action
 * entirely reads as broken rather than as pressure.
 */
export const STRESS_MAX_DAMPING = 0.4;

export interface BlocMemberState {
  entityId: string;
  /** This bloc's share of the member, 0-100. */
  share: number;
  /**
   * The largest share any RIVAL pole holds of this member, 0-100. Absent = no
   * rival is invested, which is the same as uncontested.
   */
  rivalShare?: number;
  /** Set while the member's share sits at the leave threshold. */
  wantsOutSinceTurn?: number | null;
  /** Turn the member acceded. */
  joinedTurn?: number | null;
}

export interface BlocStressBreakdown {
  /** 0-1 overall gauge. */
  stress: number;
  /** Fraction of members the rivals are actively pulling at. */
  contested: number;
  /** Fraction of members at the leave threshold. */
  wantsOut: number;
  /** Fraction of members acceded within the digestion window. */
  digesting: number;
  memberCount: number;
}

/**
 * Stress for one bloc. An empty bloc has none — there is nothing to hold
 * together, and dividing by zero members would otherwise make it maximal.
 */
export function computeBlocStress(
  members: BlocMemberState[],
  currentTurn: number
): BlocStressBreakdown {
  const memberCount = members.length;
  if (memberCount === 0) {
    return { stress: 0, contested: 0, wantsOut: 0, digesting: 0, memberCount: 0 };
  }

  let contestedCount = 0;
  let wantsOutCount = 0;
  let digestingCount = 0;
  for (const m of members) {
    if ((m.rivalShare ?? 0) >= CONTESTED_RIVAL_MIN) contestedCount++;
    if (m.wantsOutSinceTurn != null) wantsOutCount++;
    // `joinedTurn > 0` excludes founding and seeded members, which the seeders
    // stamp with turn 0. Without that guard every world opened with digestion
    // at 1.0 for its first twelve turns — a bloc cannot be busy absorbing the
    // members it was defined as having.
    if (
      m.joinedTurn != null &&
      m.joinedTurn > 0 &&
      currentTurn - m.joinedTurn < DIGESTION_WINDOW_TURNS
    ) {
      digestingCount++;
    }
  }

  const contested = contestedCount / memberCount;
  const wantsOut = wantsOutCount / memberCount;
  const digesting = digestingCount / memberCount;
  const stress = clamp01(
    contested * CONTESTED_WEIGHT + wantsOut * WANTS_OUT_WEIGHT + digesting * DIGESTION_WEIGHT
  );

  return { stress, contested, wantsOut, digesting, memberCount };
}

/**
 * Multiplier on a bloc's plays. 1 when unstressed, `1 - STRESS_MAX_DAMPING` at
 * maximum strain.
 */
export function blocPlayEffectiveness(stress: number): number {
  return 1 - STRESS_MAX_DAMPING * clamp01(stress);
}

/** Player-facing band for the gauge. Stress is shown, not hidden. */
export function blocStressLabel(stress: number): "Settled" | "Strained" | "Overextended" {
  if (stress < 0.25) return "Settled";
  if (stress < 0.6) return "Strained";
  return "Overextended";
}

function clamp01(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(1, v));
}

/** The pole a bloc pushes for, for callers mapping orgs to stress. */
export type BlocPole = AlignmentPoleId;
