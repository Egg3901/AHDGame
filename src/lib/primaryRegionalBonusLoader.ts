/**
 * Shared loader for the regional-bases inputs to `projectPrimaryByState`.
 *
 * Both the live stagger and every UI/snapshot callsite must thread the same
 * state-org levels + home-state map into the projection so projection and
 * actual results converge. Without this, party-aligned-but-regionally-funded
 * wins look like "upsets" against the projected centrist winner, inflating
 * momentum bonuses and misleading the UI's projected-winners map.
 *
 * Used by:
 *   - presidential primary state-detail page
 *   - party primary overview page
 *   - enrichElection projection
 *   - primaryResolution snapshot projection
 *   - admin debug primary-projection route
 *   - primaryStaggerPhase (uses an inline path to scope the query to the
 *     wave's states; this helper is for the all-states callers)
 *
 * The query is sparse (rows only exist after build actions) and runs once
 * per render. No pagination or batching needed at expected scale.
 *
 * See docs/plans/archive/2026-05/2026-05-27-presidential-primary-regional-bases-design.md
 */

import type { Db, ObjectId } from "mongodb";
import type { CharacterStateOrg, ElectionCandidate, NPP } from "@/lib/db/types";

export interface RegionalBonusInput {
  /** Election-level candidate rows (player + NPP). */
  candidates: Pick<ElectionCandidate, "_id" | "isNPP" | "characterId" | "nppId">[];
  /** Player-character home states, keyed by characterId.toString(). */
  homeStateByCharacterId: Map<string, string | null>;
  /** NPP home states, keyed by nppId.toString(). NPPs cannot invest in state org. */
  homeStateByNppId: Map<string, string | null>;
}

export interface RegionalBonusMaps {
  /** Outer key = stateId; inner = candidateId → level. Empty when no player has invested. */
  stateOrgByStateAndCandidate: Map<string, Map<string, number>>;
  /** candidateId → homeState. Built from the inputs above. */
  homeStateByCandidate: Map<string, string>;
}

/**
 * Load the per-state-and-candidate org level map + the per-candidate home-state
 * map for the given election candidates. NPP candidates contribute only home
 * states (they cannot build state org).
 */
export async function loadRegionalBonusMaps(
  db: Db,
  input: RegionalBonusInput
): Promise<RegionalBonusMaps> {
  const { candidates, homeStateByCharacterId, homeStateByNppId } = input;

  const characterIds: ObjectId[] = candidates
    .filter((c) => !c.isNPP && c.characterId)
    .map((c) => c.characterId);

  const stateOrgRows = characterIds.length
    ? await db
        .collection<CharacterStateOrg>("characterStateOrg")
        .find({ characterId: { $in: characterIds }, level: { $gt: 0 } })
        .toArray()
    : [];

  const characterIdToCandidateId = new Map<string, string>();
  for (const c of candidates) {
    if (!c.isNPP && c.characterId) {
      characterIdToCandidateId.set(c.characterId.toString(), c._id.toString());
    }
  }

  const stateOrgByStateAndCandidate = new Map<string, Map<string, number>>();
  for (const row of stateOrgRows) {
    const candidateId = characterIdToCandidateId.get(row.characterId.toString());
    if (!candidateId) continue;
    let stateMap = stateOrgByStateAndCandidate.get(row.stateId);
    if (!stateMap) {
      stateMap = new Map<string, number>();
      stateOrgByStateAndCandidate.set(row.stateId, stateMap);
    }
    stateMap.set(candidateId, row.level);
  }

  const homeStateByCandidate = new Map<string, string>();
  for (const c of candidates) {
    if (c.isNPP && c.nppId) {
      const home = homeStateByNppId.get(c.nppId.toString());
      if (home) homeStateByCandidate.set(c._id.toString(), home);
    } else if (!c.isNPP && c.characterId) {
      const home = homeStateByCharacterId.get(c.characterId.toString());
      if (home) homeStateByCandidate.set(c._id.toString(), home);
    }
  }

  return { stateOrgByStateAndCandidate, homeStateByCandidate };
}

/**
 * Helper that fetches characters + npps for the given election candidates,
 * then builds the home-state maps + delegates to `loadRegionalBonusMaps`.
 *
 * Use this when the calling code doesn't already have character/NPP docs
 * loaded — saves a round-trip of duplicate code at each callsite.
 */
export async function loadRegionalBonusMapsWithLookup(
  db: Db,
  candidates: Pick<ElectionCandidate, "_id" | "isNPP" | "characterId" | "nppId">[]
): Promise<RegionalBonusMaps> {
  const characterIds = candidates
    .filter((c) => !c.isNPP && c.characterId)
    .map((c) => c.characterId);
  const nppIds = candidates.filter((c) => c.isNPP && c.nppId).map((c) => c.nppId!);

  const [chars, npps] = await Promise.all([
    characterIds.length
      ? db
          .collection<{ _id: ObjectId; homeState?: string }>("characters")
          .find({ _id: { $in: characterIds } }, { projection: { homeState: 1 } })
          .toArray()
      : Promise.resolve([]),
    nppIds.length
      ? db
          .collection<NPP>("npps")
          .find({ _id: { $in: nppIds } }, { projection: { homeState: 1 } })
          .toArray()
      : Promise.resolve([]),
  ]);

  const homeStateByCharacterId = new Map(chars.map((c) => [c._id.toString(), c.homeState ?? null]));
  const homeStateByNppId = new Map(npps.map((n) => [n._id.toString(), n.homeState ?? null]));

  return loadRegionalBonusMaps(db, { candidates, homeStateByCharacterId, homeStateByNppId });
}
