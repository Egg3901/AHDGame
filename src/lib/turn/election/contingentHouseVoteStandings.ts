/**
 * Live ballot of the open House vote: loads the sitting House through the same
 * voter-profile path the engine's ballot uses, drops candidacies that have left
 * the race, and applies the cast votes and whips (see `computeHouseVoteStandings`).
 */
import { ObjectId } from "mongodb";
import type { Db } from "@/lib/mongodb";
import type {
  Character,
  Coalition,
  Election,
  ElectionCandidate,
  ElectionVoteTally,
  NPP,
} from "@/lib/db/types";
import type { CountryId } from "@/lib/constants/countries";
import {
  computeHouseVoteStandings,
  type HouseVoteStandings,
} from "@/lib/elections/contingentHouseStandings";
import { loadContingentElectionData } from "@/lib/turn/election/loadContingentElectionData";

export type ContingentHouseVoteRecord = NonNullable<ElectionVoteTally["contingentHouseVote"]>;

export interface LiveHouseVoteStandings extends HouseVoteStandings {
  /** Eligible candidacies still on the ballot. */
  activeCandidateIds: string[];
  /** Eligible candidacies that withdrew, were deleted, died or retired. */
  droppedCandidateIds: string[];
}

/**
 * Split the eligible candidacies into those still running and those gone. A
 * candidacy is gone when it withdrew, its character was deleted (a retired
 * character is removed), or its NPP retired or no longer exists.
 */
export async function partitionEligibleCandidates(
  db: Db,
  eligibleCandidateIds: string[]
): Promise<{ active: ElectionCandidate[]; droppedIds: string[] }> {
  const candidacies = await db
    .collection<ElectionCandidate>("electionCandidates")
    .find({ _id: { $in: eligibleCandidateIds.map((id) => new ObjectId(id)) } })
    .toArray();
  const charIds = candidacies
    .filter((c) => !c.isNPP && c.characterId)
    .map((c) => c.characterId as ObjectId);
  const nppIds = candidacies.filter((c) => c.isNPP && c.nppId).map((c) => c.nppId as ObjectId);
  const [chars, npps] = await Promise.all([
    charIds.length > 0
      ? db
          .collection<Character>("characters")
          .find({ _id: { $in: charIds } })
          .project({ _id: 1 })
          .toArray()
      : [],
    nppIds.length > 0
      ? db
          .collection<NPP>("npps")
          .find({ _id: { $in: nppIds } })
          .project({ _id: 1, retiredAt: 1 })
          .toArray()
      : [],
  ]);
  const liveChars = new Set(chars.map((c) => c._id.toString()));
  const liveNpps = new Set(
    (npps as Pick<NPP, "_id" | "retiredAt">[])
      .filter((n) => !n.retiredAt)
      .map((n) => n._id.toString())
  );

  const active: ElectionCandidate[] = [];
  for (const c of candidacies) {
    const holderPresent = c.isNPP
      ? c.nppId != null && liveNpps.has(c.nppId.toString())
      : c.characterId != null && liveChars.has(c.characterId.toString());
    if (c.status === "active" && holderPresent) active.push(c);
  }
  const activeIds = new Set(active.map((c) => c._id.toString()));
  return { active, droppedIds: eligibleCandidateIds.filter((id) => !activeIds.has(id)) };
}

/** Party sequential id to the sequential id of the coalition it belongs to. */
export async function loadPartyCoalitions(
  db: Db,
  countryId: string
): Promise<Record<string, string>> {
  let coalitions: Pick<Coalition, "sequentialId" | "members">[] = [];
  try {
    coalitions = await db
      .collection<Coalition>("coalitions")
      .find({ countryId: countryId as CountryId })
      .project<Pick<Coalition, "sequentialId" | "members">>({ sequentialId: 1, members: 1 })
      .toArray();
  } catch {
    // No coalition data: only party whips apply.
  }
  const out: Record<string, string> = {};
  for (const coalition of coalitions) {
    for (const member of coalition.members ?? []) {
      out[String(member.partySequentialId)] = String(coalition.sequentialId);
    }
  }
  return out;
}

export async function loadHouseVoteStandings(
  db: Db,
  election: Pick<Election, "_id" | "countryId">,
  tally: Pick<ElectionVoteTally, "electoralVotesByCandidate">,
  vote: Pick<ContingentHouseVoteRecord, "eligibleCandidateIds" | "votes" | "whips">
): Promise<LiveHouseVoteStandings> {
  const countryId = election.countryId ?? "US";
  const { active, droppedIds } = await partitionEligibleCandidates(db, vote.eligibleCandidateIds);
  const [data, partyCoalition] = await Promise.all([
    loadContingentElectionData(
      db,
      election._id,
      countryId,
      active,
      tally.electoralVotesByCandidate ?? {}
    ),
    loadPartyCoalitions(db, countryId),
  ]);
  const activeIds = new Set(active.map((c) => c._id.toString()));
  const standings = computeHouseVoteStandings({
    delegations: data.houseDelegations,
    candidates: data.presidentCandidates.filter((c) => activeIds.has(c.id)),
    votes: vote.votes ?? {},
    whips: vote.whips,
    partyCoalition,
    tieSeed: election._id.toString(),
  });
  return {
    ...standings,
    activeCandidateIds: vote.eligibleCandidateIds.filter((id) => activeIds.has(id)),
    droppedCandidateIds: droppedIds,
  };
}
