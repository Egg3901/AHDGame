// General/commander combat model. Levels + skill points + the combat-modifier
// shape. A general's actual modifiers come from the era-gated trait tree they
// train (generalsTree.ts `generalMods`), which is the only trait system — the
// former GENSPEC spec-track was read by battle math but written by nothing, so it
// was retired in W9 along with the once-chosen `spec`/`traits` fields.

export type GeneralSpec = "armor" | "offense" | "defense" | "logi" | "naval";

/** A general/commander (combat-relevant fields). Specialisation is not a field —
 *  it is derived from the trait nodes they have trained (see `deriveSpec`). */
export interface General {
  level: number;
  xp: number;
  pts: number;
  id?: string;
  name?: string;
  chop?: string;
  /**
   * Turn the last tenure point was paid. Absent on any profile predating tenure
   * accrual — those start their clock at the next tick rather than being back-paid
   * for a career they already served.
   */
  lastTenurePointTurn?: number;
  /**
   * Points this general has taken from tenure over their whole career, against
   * `TENURE_POINT_CAP`. Tracked separately from `pts` because `pts` is spent.
   */
  tenurePointsEarned?: number;
  /**
   * Points granted by the post-Field-Marshal track, against `POST_FM_POINT_CAP`.
   * Counts POINTS, not the XP behind them, so the award stays idempotent.
   */
  postFieldMarshalPoints?: number;
}

export const GENRANK = ["Brigadier", "Major General", "Lt. General", "General", "Field Marshal"];
export const GENLVLXP = [0, 100, 250, 460, 740];

export interface GenMods {
  cv: number;
  cvTrait: Record<string, number>;
  cas: number;
  supply: number;
  upkeep: number;
  ready: number;
  enemy: number;
}

export function rank(level: number): string {
  return GENRANK[Math.max(0, Math.min(4, level - 1))];
}

/**
 * Flat participation XP, on top of the share earned from the units a general led.
 *
 * The per-unit share is `(16 + ratio×20) × natMods.xp`, so for a nation fielding one
 * or two formations this flat bonus is most of the award — raising it speeds the
 * ladder for small armies far more than for a superpower leading a dozen divisions,
 * which is the right direction.
 */
export const WIN_BONUS_XP = 45;
export const LOSS_BONUS_XP = 20;

/**
 * Skill points granted per promotion.
 *
 * Level caps at 5, so this is paid exactly four times in a career — 16 points. With
 * every node priced at 1, points and nodes are the same currency, so the whole budget
 * is legible: 4 starting + 16 promotions + 20 tenure + 15 post-Field-Marshal = 55 of
 * the tree's 115 nodes at absolute most. A general specialises because they cannot
 * afford not to.
 */
export const POINTS_PER_PROMOTION = 4;

/** Cumulative XP past the Field Marshal ceiling that earns one more skill point. */
export const POST_FM_XP_PER_POINT = 200;

/**
 * Lifetime ceiling on points from the post-Field-Marshal track.
 *
 * The track exists because a general who has maxed the rank ladder otherwise has
 * nothing left to earn from campaigning. It is capped because an uncapped one hands
 * a late-game commander every node in the tree — "don't need one general in the late
 * game where they have all skills because he's commanding everything", which is the
 * feedback that shaped this number.
 */
export const POST_FM_POINT_CAP = 15;

/** A general's standing on the promotion ladder, for display. */
export interface RankProgress {
  rank: string;
  /** The rank after this one, or null at the Field Marshal ceiling. */
  nextRank: string | null;
  /** XP earned since reaching the current rank. */
  xpIntoRank: number;
  /** XP the current rank spans; null at the ceiling. */
  xpForRank: number | null;
  /** 0..1 across the current rank; 1 at the ceiling. */
  pct: number;
}

/**
 * Where a general stands between their current rank and the next.
 *
 * `xp` is cumulative — `levelGeneral` never spends it — so progress within a rank
 * is the span between two GENLVLXP thresholds rather than a running balance.
 */
export function rankProgress(level: number, xp: number): RankProgress {
  const lvl = Math.max(1, Math.min(5, level));
  const floor = GENLVLXP[lvl - 1] ?? 0;
  const ceil = lvl >= 5 ? null : (GENLVLXP[lvl] ?? null);
  if (ceil === null) {
    return { rank: rank(lvl), nextRank: null, xpIntoRank: 0, xpForRank: null, pct: 1 };
  }
  const span = Math.max(1, ceil - floor);
  const into = Math.max(0, Math.min(span, xp - floor));
  return {
    rank: rank(lvl),
    nextRank: rank(lvl + 1),
    xpIntoRank: into,
    xpForRank: span,
    pct: into / span,
  };
}

/**
 * Award XP, apply level-ups, and run the post-Field-Marshal track.
 *
 * Past the rank-5 ceiling every {@link POST_FM_XP_PER_POINT} cumulative XP earns one
 * more point, up to {@link POST_FM_POINT_CAP}. Without that track a maxed general has
 * nothing left to earn from campaigning; without the cap they eventually hold every
 * node in the tree.
 *
 * `postFieldMarshalPoints` records POINTS granted, not the XP they came from, so the
 * ceiling is expressible and re-running the award grants nothing further. Generic in
 * the general shape so a full ProfileGeneral round-trips with its `gtraits` intact.
 */
export function levelGeneral<T extends General>(g: T, addXp: number): T {
  const ng: T = { ...g, xp: g.xp + addXp };
  while (ng.level < 5 && ng.xp >= (GENLVLXP[ng.level] ?? Infinity)) {
    ng.level += 1;
    ng.pts = (ng.pts || 0) + POINTS_PER_PROMOTION;
  }
  if (ng.level >= 5) {
    const fmXp = Math.max(0, ng.xp - (GENLVLXP[4] ?? 740));
    const owed = Math.min(POST_FM_POINT_CAP, Math.floor(fmXp / POST_FM_XP_PER_POINT));
    const grant = owed - (ng.postFieldMarshalPoints ?? 0);
    if (grant > 0) {
      ng.pts = (ng.pts || 0) + grant;
      ng.postFieldMarshalPoints = owed;
    }
  }
  return ng;
}

/**
 * Turns of service per tenure skill point. One real day — a turn is a real hour.
 *
 * Deliberately faster than the game-year it started at: the moment tenure feels dead
 * is a newly commissioned general's first week, not their tenth year, and a two-day
 * wait for the first point is what made progression read as broken.
 */
export const TENURE_POINT_TURNS = 24;

/**
 * Lifetime ceiling on points earned from tenure alone.
 *
 * Reached after 480 turns (~20 real days) of service, after which a general develops
 * only by fighting. Deliberately smaller than what campaigning pays (16 promotion +
 * 15 post-Field-Marshal): tenure exists so a peacetime officer is not frozen, not so
 * that waiting competes with fighting.
 */
export const TENURE_POINT_CAP = 20;

/**
 * Skill points a general earns for time served in the corps.
 *
 * Battles were the ONLY source of points, which meant an officer in a nation at
 * peace never developed at all — the complaint that prompted this was that
 * progression "seems slow and people won't be levelled correctly for a while".
 * Command experience accumulates in garrison too; this is that.
 *
 * Returns null when nothing is owed, so callers can skip the write entirely.
 *
 * Pays EVERY whole interval elapsed and advances the marker by exactly those,
 * never to `now`. A stalled cron or a paused world must not swallow the points it
 * owed, and the catch-up tick must not pay them twice. A general with no marker
 * starts their clock now rather than being back-paid for the whole war.
 */
export function accrueTenurePoints<T extends General>(
  g: T,
  currentTurn: number
): (T & { lastTenurePointTurn: number }) | null {
  if (g.lastTenurePointTurn == null) {
    return { ...g, lastTenurePointTurn: currentTurn };
  }
  const alreadyEarned = g.tenurePointsEarned ?? 0;
  const remaining = TENURE_POINT_CAP - alreadyEarned;
  if (remaining <= 0) return null;

  const elapsed = currentTurn - g.lastTenurePointTurn;
  if (elapsed < TENURE_POINT_TURNS) return null;
  // Clamp to the lifetime ceiling, and advance the marker only by the intervals
  // actually PAID — so a general at the cap does not bank credit that would pay out
  // in a lump the moment the cap were ever raised.
  const earned = Math.min(Math.floor(elapsed / TENURE_POINT_TURNS), remaining);
  return {
    ...g,
    pts: (g.pts || 0) + earned,
    tenurePointsEarned: alreadyEarned + earned,
    lastTenurePointTurn: g.lastTenurePointTurn + earned * TENURE_POINT_TURNS,
  };
}
