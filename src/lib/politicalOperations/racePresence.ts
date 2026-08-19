import type { Db, ObjectId } from "mongodb";
import type { CharacterStateOrg, Election, ElectionCandidate } from "@/lib/db/types";

/**
 * One candidate in the live presidential race, with their Campaign Presence
 * level per state.
 */
export interface RacePresenceEntry {
  characterId: string;
  name: string;
  /** Party sequential id as stored on the candidacy, or null for independents. */
  party: string | null;
  isSelf: boolean;
  levelsByState: Record<string, number>;
}

/**
 * Campaign Presence for every candidate in the live presidential race.
 *
 * Why this exists: the Campaign Presence map previously rendered only the
 * VIEWER's own per-state levels. A player who never ran for President saw their
 * own (usually empty) map and none of the actual candidates' — which reads as a
 * bug, because the panel is framed as presidential infrastructure. Returning the
 * whole field lets the map show contested ground and lets a non-candidate follow
 * the race at all.
 *
 * Presence is deliberately public: it is physical campaign infrastructure that
 * the opposing campaign can see on the ground, so there is no fog-of-war here.
 *
 * Returns `[]` when there is no live presidential race, which callers should
 * treat as "hide the selector" rather than an error.
 */
export async function loadRacePresence(db: Db, viewerId: ObjectId): Promise<RacePresenceEntry[]> {
  const election = await db
    .collection<Election>("elections")
    .findOne(
      { countryId: "US", electionType: "president", status: { $in: ["upcoming", "active"] } },
      { projection: { _id: 1 } }
    );
  if (!election) return [];

  const runners = await db
    .collection<ElectionCandidate>("electionCandidates")
    .find(
      { electionId: election._id, status: "active" },
      { projection: { characterId: 1, characterName: 1, party: 1 } }
    )
    .toArray();
  const runnerIds = runners.map((r) => r.characterId).filter(Boolean);
  if (runnerIds.length === 0) return [];

  const orgRows = await db
    .collection<CharacterStateOrg>("characterStateOrg")
    .find(
      { characterId: { $in: runnerIds } },
      { projection: { characterId: 1, stateId: 1, level: 1 } }
    )
    .toArray();

  const byCharacter = new Map<string, Record<string, number>>();
  for (const row of orgRows) {
    const key = row.characterId.toString();
    const bucket = byCharacter.get(key) ?? {};
    bucket[row.stateId] = row.level ?? 0;
    byCharacter.set(key, bucket);
  }

  return runners.map((r) => {
    const key = r.characterId.toString();
    return {
      characterId: key,
      name: r.characterName ?? key,
      party: r.party ?? null,
      isSelf: r.characterId.equals(viewerId),
      levelsByState: byCharacter.get(key) ?? {},
    };
  });
}
