/**
 * Faction divergence — who actually leaves when a one-party regime splits.
 *
 * `fireFactionSplit` has always picked its defectors from a placeholder that
 * scored EVERY official at zero, so the Stage-3 split fell back to input order
 * and took an arbitrary 15% of the ruling party's bench. The party that walked
 * out was also given the ruling party's own axis positions verbatim, so the
 * "Reformist Faction of the CPSU" was ideologically indistinguishable from the
 * CPSU it had just left. A regime split that picks arbitrary people to found an
 * identical party is not a faction split; it is a rename.
 *
 * Two pure kernels here fix that, and both are deliberately DB-free so the
 * politics can be reasoned about and tested without a world:
 *
 *  - {@link scoreDivergence} ranks an official on how far they sit from the
 *    party line, on the same (economic, social) axes the election engine
 *    already uses for policy distance.
 *  - {@link applyCaucusCohesion} makes a faction leave AS a faction. Players in
 *    one-party states have already self-organised into caucuses (the live 1953
 *    world's only non-US/UK caucuses are the CPSU's "Soviet Honor Guard" and
 *    "New Leninist Course"), and a split that cut across those groupings at
 *    random would ignore the one piece of structure the players built.
 */

/** Axis half-range: positions run roughly -5..+5, so max Manhattan distance is 20. */
const AXIS_SCALE = 5;
const MAX_DISTANCE = 4 * AXIS_SCALE;

/**
 * How much of a member's score comes from their caucus rather than themselves.
 * At 0.6 the caucus dominates without erasing the individual, so a moderate
 * sitting in a militant caucus still leaves with it, while a lone hardliner in
 * no caucus can still be divergent enough to go.
 */
export const CAUCUS_COHESION_WEIGHT = 0.6;

const clamp01 = (v: number): number => (!Number.isFinite(v) ? 0 : Math.min(1, Math.max(0, v)));

export interface DivergenceInput {
  characterId: string;
  /** Character's own economic axis position, -5..+5. */
  economic: number | null | undefined;
  /** Character's own social axis position, -5..+5. */
  social: number | null | undefined;
  /** Caucus this official belongs to within the ruling party, if any. */
  caucusId?: string | null;
}

export interface PartyLine {
  economic: number;
  social: number;
}

/**
 * Divergence of one official from the party line, normalised to 0..1.
 *
 * Manhattan distance on the two axes, which is what `voteDistribution` uses for
 * policy distance, so a player reading their own position against the party's
 * can predict this. An official with no recorded position scores 0: absence of
 * evidence is not evidence of disloyalty, and the alternative (treating a null
 * as maximally distant) would purge every NPC-imported official first.
 */
export function scoreDivergence(official: DivergenceInput, line: PartyLine): number {
  const econ = official.economic;
  const social = official.social;
  if (!Number.isFinite(econ) || !Number.isFinite(social)) return 0;
  const distance =
    Math.abs((econ as number) - line.economic) + Math.abs((social as number) - line.social);
  return clamp01(distance / MAX_DISTANCE);
}

export interface ScoredOfficial {
  characterId: string;
  divergence: number;
  caucusId: string | null;
}

/**
 * Blend each official's own divergence toward their caucus's mean, so a faction
 * ranks and therefore leaves together.
 *
 * Officials in no caucus keep their individual score untouched, which leaves the
 * no-caucus world byte-identical to plain {@link scoreDivergence} ranking.
 */
export function applyCaucusCohesion(
  scored: ReadonlyArray<ScoredOfficial>,
  weight = CAUCUS_COHESION_WEIGHT
): ScoredOfficial[] {
  const w = clamp01(weight);
  // Clamp on the way IN, not just on the way out. An out-of-range score would
  // otherwise pass straight through for an unaffiliated official and, worse,
  // drag a caucus mean outside 0..1 for everyone in it.
  const safe = scored.map((s) => ({ ...s, divergence: clamp01(s.divergence) }));

  const sums = new Map<string, { total: number; count: number }>();
  for (const s of safe) {
    if (!s.caucusId) continue;
    const acc = sums.get(s.caucusId) ?? { total: 0, count: 0 };
    acc.total += s.divergence;
    acc.count += 1;
    sums.set(s.caucusId, acc);
  }
  return safe.map((s) => {
    if (!s.caucusId) return { ...s };
    const acc = sums.get(s.caucusId);
    if (!acc || acc.count === 0) return { ...s };
    const caucusMean = acc.total / acc.count;
    return { ...s, divergence: clamp01(s.divergence * (1 - w) + caucusMean * w) };
  });
}

/**
 * The centre of gravity of the officials who actually left, used as the new
 * party's axis positions.
 *
 * Without this the defected party inherits the ruling party's positions exactly
 * and is a copy of what it broke from. Falls back to the party line when no
 * defector has a recorded position, which at least keeps the new party on a
 * coherent point rather than at the origin.
 */
export function factionCentreOfGravity(
  defectors: ReadonlyArray<Pick<DivergenceInput, "economic" | "social">>,
  fallback: PartyLine
): PartyLine {
  let econTotal = 0;
  let socialTotal = 0;
  let count = 0;
  for (const d of defectors) {
    if (!Number.isFinite(d.economic) || !Number.isFinite(d.social)) continue;
    econTotal += d.economic as number;
    socialTotal += d.social as number;
    count += 1;
  }
  if (count === 0) return { ...fallback };
  const round = (v: number) => Math.round(v * 10) / 10;
  return { economic: round(econTotal / count), social: round(socialTotal / count) };
}
