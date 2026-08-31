/**
 * Affinity model for suspend-and-endorse support transfers (presidential rework).
 *
 * When a nominee suspends and endorses a rival, some of their ground org (and
 * campaign strength) carries to the endorsee. Under the legacy "flat" mode the
 * whole ceiling fraction transfers regardless of how aligned the two are. Under
 * "affinity" mode the ceiling is scaled by how close the pair is ideologically
 * (economic/social position) and in coalition terms (the bucket-favorability
 * substrate, keyed `party:groupId`). A perfectly aligned suspender still
 * transfers the full ceiling; a misaligned one transfers proportionally less.
 *
 * Pure and deterministic — no RNG, no IO. The same affinity function backs the
 * convention delegate-release redistribution (see conventionResolution.ts), so
 * both the engine transfer and the convention share one alignment definition.
 */

/** Policy axes run -5..+5, so the widest possible (EP,SP) separation is √200. */
const MAX_AXIS_DISTANCE = Math.sqrt(200);

/** Weight on the ideological (position) component of blended affinity. */
const IDEOLOGY_WEIGHT = 0.7;
/** Weight on the coalition (bucket-favorability overlap) component. */
const COALITION_WEIGHT = 0.3;

export interface AffinityCandidate {
  /** Candidate economic position, -5..+5. */
  charEP: number;
  /** Candidate social position, -5..+5. */
  charSP: number;
  /** Party id used to key the bucket-favorability substrate (`party:groupId`). */
  party: string;
}

/**
 * Ideological closeness on the (EP, SP) plane, mapped to [0, 1]. Identical
 * positions => 1; the two most extreme opposite corners => 0.
 */
function ideologicalAffinity(a: AffinityCandidate, b: AffinityCandidate): number {
  const dist = Math.hypot(a.charEP - b.charEP, a.charSP - b.charSP);
  return Math.max(0, Math.min(1, 1 - dist / MAX_AXIS_DISTANCE));
}

/**
 * Coalition overlap: cosine similarity of the two parties' bucket-favorability
 * vectors (over the union of groups either party has a delta for), remapped from
 * [-1, 1] to [0, 1]. Returns null when neither party carries any bucket signal,
 * so the caller can fall back to the ideological component alone rather than
 * inventing a neutral 0.5.
 */
function coalitionAffinity(
  a: AffinityCandidate,
  b: AffinityCandidate,
  partyGroupFavorabilityByKey: Map<string, number> | undefined
): number | null {
  if (!partyGroupFavorabilityByKey || partyGroupFavorabilityByKey.size === 0) return null;

  const groupIds = new Set<string>();
  for (const key of partyGroupFavorabilityByKey.keys()) {
    const sep = key.indexOf(":");
    if (sep < 0) continue;
    const party = key.slice(0, sep);
    if (party === a.party || party === b.party) groupIds.add(key.slice(sep + 1));
  }
  if (groupIds.size === 0) return null;

  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (const groupId of groupIds) {
    const va = partyGroupFavorabilityByKey.get(`${a.party}:${groupId}`) ?? 0;
    const vb = partyGroupFavorabilityByKey.get(`${b.party}:${groupId}`) ?? 0;
    dot += va * vb;
    normA += va * va;
    normB += vb * vb;
  }
  if (normA === 0 || normB === 0) return null;

  const cosine = dot / (Math.sqrt(normA) * Math.sqrt(normB));
  return Math.max(0, Math.min(1, (cosine + 1) / 2));
}

/**
 * Blended affinity in [0, 1] between two candidates: ideological closeness,
 * blended with coalition overlap when the bucket substrate carries any signal.
 */
export function computeCandidateAffinity(params: {
  a: AffinityCandidate;
  b: AffinityCandidate;
  partyGroupFavorabilityByKey?: Map<string, number>;
}): number {
  const { a, b, partyGroupFavorabilityByKey } = params;
  const ideo = ideologicalAffinity(a, b);
  const coalition = coalitionAffinity(a, b, partyGroupFavorabilityByKey);
  if (coalition === null) return ideo;
  return IDEOLOGY_WEIGHT * ideo + COALITION_WEIGHT * coalition;
}

/**
 * Resolve the fraction of a suspended campaign's support that transfers to its
 * endorsee.
 *
 *   * "flat"     => exactly `maxFraction`, ignoring alignment (legacy behavior).
 *   * "affinity" => `affinity * maxFraction`, so a perfectly aligned pair still
 *                   transfers the full `maxFraction` and misaligned pairs less.
 */
export function computeSuspendTransferFraction(params: {
  suspender: AffinityCandidate;
  endorsed: AffinityCandidate;
  mode: "flat" | "affinity";
  maxFraction: number;
  partyGroupFavorabilityByKey?: Map<string, number>;
}): number {
  const { suspender, endorsed, mode, maxFraction, partyGroupFavorabilityByKey } = params;
  if (mode === "flat") return maxFraction;
  const affinity = computeCandidateAffinity({
    a: suspender,
    b: endorsed,
    partyGroupFavorabilityByKey,
  });
  return affinity * maxFraction;
}
