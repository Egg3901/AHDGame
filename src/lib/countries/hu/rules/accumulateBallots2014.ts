import { apportionSeats } from "@/lib/seeds/reference/rules/apportionSeats";
import { huDistrictIds } from "./constituencies2014";

export interface HuBallotCandidate {
  candidateId: string;
  partyId: string;
  constituencyId?: string;
  votes: number;
  listAppeal?: number;
}

/** Persist separate vote streams at each campaign turn. A filed candidate only
 * appears in their district; legacy unfiled slates remain available districtwide. */
export function accumulateHuBallots(
  regionId: string,
  candidates: ReadonlyArray<HuBallotCandidate>,
  previousDistricts: Record<string, Record<string, number>> = {},
  previousLists: Record<string, number> = {}
): {
  constituencyVotes: Record<string, Record<string, number>>;
  listVotes: Record<string, number>;
} {
  const districts = huDistrictIds(regionId);
  const constituencyVotes = Object.fromEntries(
    districts.map((id) => [id, { ...(previousDistricts[id] ?? {}) }])
  );
  const listVotes = { ...previousLists };
  for (const candidate of candidates) {
    if (!Number.isSafeInteger(candidate.votes) || candidate.votes < 0) {
      throw new Error("Invalid Hungarian turn vote");
    }
    const eligible = candidate.constituencyId ? [candidate.constituencyId] : districts;
    if (eligible.some((id) => !districts.includes(id))) {
      throw new Error("Hungarian candidate filed outside region");
    }
    const districtShares = apportionSeats(
      candidate.constituencyId ? Math.round(candidate.votes / districts.length) : candidate.votes,
      Object.fromEntries(eligible.map((id) => [id, 1]))
    );
    for (const [id, votes] of Object.entries(districtShares)) {
      constituencyVotes[id][candidate.candidateId] =
        (constituencyVotes[id][candidate.candidateId] ?? 0) + votes;
    }
    if (candidate.partyId !== "independent") {
      // A separate national-list stream. Its turnout pool matches the regional
      // turnout, while ballot choices use the regional organization multiplier.
      listVotes[candidate.partyId] =
        (listVotes[candidate.partyId] ?? 0) +
        Math.round(candidate.votes * (candidate.listAppeal ?? 1));
    }
  }
  return { constituencyVotes, listVotes };
}
