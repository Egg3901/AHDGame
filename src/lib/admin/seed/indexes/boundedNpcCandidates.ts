/**
 * Bounded NPC nominees share a profile while players keep one active candidacy.
 * ensureBoundedNpcCandidateGuards creates and verifies replacement guards before
 * removing the legacy guard, so a failed migration keeps existing protection.
 */
import type { Db } from "mongodb";
import type { IndexSpecTuple } from "./writeGuardSpecs";
const legacyName = "unique_active_election_candidate_per_character";
export const BOUNDED_NPC_CANDIDATE_GUARDS: IndexSpecTuple[] = [
  [
    "electionCandidates",
    { characterId: 1 },
    {
      name: "unique_active_player_or_unbounded_npc_candidate",
      unique: true,
      partialFilterExpression: {
        status: "active",
        $or: [{ isNPP: { $in: [false, null] } }, { boundedNpcNomineeId: null }],
      },
    },
  ],
  [
    "electionCandidates",
    { boundedNpcNomineeId: 1 },
    {
      name: "unique_active_bounded_npc_nominee",
      unique: true,
      partialFilterExpression: {
        status: "active",
        isNPP: true,
        boundedNpcNomineeId: { $type: "objectId" },
      },
    },
  ],
];
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonical(entry)}`)
      .join(",")}}`;
  return JSON.stringify(value) ?? "undefined";
}
export async function ensureBoundedNpcCandidateGuards(db: Db): Promise<void> {
  const collection = db.collection("electionCandidates");
  // Do not use tolerant ensureIndex here: its same-key fallback does not
  // establish that a partial filter protects the intended population.
  for (const [, key, options] of BOUNDED_NPC_CANDIDATE_GUARDS) {
    await collection.createIndex(key, options);
  }
  const indexes = await collection.indexes();
  for (const [, key, options] of BOUNDED_NPC_CANDIDATE_GUARDS) {
    const index = indexes.find((row) => row.name === options.name);
    if (
      !index ||
      index.unique !== true ||
      canonical(index.key) !== canonical(key) ||
      canonical(index.partialFilterExpression) !== canonical(options.partialFilterExpression)
    ) {
      throw new Error("Bounded NPC candidacy replacement guards were not verified");
    }
  }
  const legacy = indexes.find((row) => row.name === legacyName);
  if (legacy) {
    if (
      legacy.unique !== true ||
      canonical(legacy.key) !== canonical({ characterId: 1 }) ||
      canonical(legacy.partialFilterExpression) !== canonical({ status: "active" })
    ) {
      throw new Error("Unexpected legacy candidacy guard; refusing to remove it");
    }
    await collection.dropIndex(legacyName);
  }
}
