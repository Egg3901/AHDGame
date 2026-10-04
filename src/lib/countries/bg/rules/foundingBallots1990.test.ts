import { describe, expect, it } from "vitest";
import { BG_1990_LIST_DISTRICTS } from "../data/foundingDistricts1990";
import { buildBgFoundingSlates } from "./foundingSlates1990";
import {
  projectBgFoundingBallots,
  projectBgFoundingRunoff,
  type BgFoundingRegionalCampaign,
} from "./foundingBallots1990";
import { countBgFoundingElection } from "./foundingCount1990";
import { settleBgFoundingMandates } from "./foundingMandates1990";

function fixture() {
  const regions = [...new Set(BG_1990_LIST_DISTRICTS.map((row) => row.regionId))];
  const candidates = regions.flatMap((regionId) =>
    ["a", "b"].map((partyId, index) => ({
      id: `${regionId}-${partyId}`,
      ownerId: `${regionId}-${partyId}`,
      isNpc: true,
      partyId,
      regionId,
      listOrder: index,
    }))
  );
  const { nominations } = buildBgFoundingSlates(candidates);
  const campaigns: BgFoundingRegionalCampaign[] = regions.map((regionId) => ({
    regionId,
    registeredVoters: 100000,
    candidates: [
      { candidateId: `${regionId}-a`, votes: 48000, listVotes: 24000 },
      { candidateId: `${regionId}-b`, votes: 32000, listVotes: 56000 },
    ],
  }));
  return { nominations, campaigns };
}

describe("Bulgarian founding two-ballot campaign", () => {
  it("preserves separate ballot support, regional turnout and all400 mandates", () => {
    const { nominations, campaigns } = fixture();
    const ballots = projectBgFoundingBallots(campaigns, nominations);
    const count = countBgFoundingElection(ballots);
    expect(count.kind).toBe("certified");
    expect(count.lists.kind).toBe("allocated");
    if (count.lists.kind !== "allocated") throw new Error("Expected list count");
    expect(count.lists.partySeats).toEqual({ a: 60, b: 140 });
    const people = new Map(nominations.people.map((row) => [row.id, row]));
    expect(
      Object.values(count.constituencyWinners).every((id) => people.get(id!)?.partyId === "a")
    ).toBe(true);
    for (const campaign of campaigns) {
      const direct = ballots.constituencies.filter(
        (row) => people.get(row.first.options[0].personId)?.regionId === campaign.regionId
      );
      expect(direct.reduce((value, row) => value + row.first.registeredVoters, 0)).toBe(100000);
      expect(direct.reduce((value, row) => value + row.first.ballotsCast, 0)).toBe(80000);
      const listAreas = new Set(
        BG_1990_LIST_DISTRICTS.filter((row) => row.regionId === campaign.regionId).map(
          (row) => row.id
        )
      );
      const lists = ballots.lists.filter((row) => listAreas.has(row.districtId));
      expect(lists.reduce((value, row) => value + row.partyVotes.a, 0)).toBe(24000);
      expect(lists.reduce((value, row) => value + row.partyVotes.b, 0)).toBe(56000);
    }
    const settled = settleBgFoundingMandates({
      nominations,
      constituencyWinners: count.constituencyWinners,
      districtListSeats: count.lists.districtSeats,
      availablePersonIds: new Set(nominations.people.map((row) => row.id)),
    });
    expect(settled.partySeats).toEqual({ a: 260, b: 140 });
    expect(settled.mandates).toHaveLength(400);
  });
  it("low first-round turnout opens runoffs and real new votes change direct winners without changing lists", () => {
    const { nominations, campaigns } = fixture();
    const firstCampaigns = campaigns.map((row) => ({
      ...row,
      candidates: row.candidates.map((candidate) => ({
        ...candidate,
        votes: candidate.votes / 2,
        listVotes: candidate.listVotes! / 2,
      })),
    }));
    const first = projectBgFoundingBallots(firstCampaigns, nominations);
    expect(countBgFoundingElection(first).unresolved).toHaveLength(200);
    const renewed = campaigns.map((row) => ({
      ...row,
      candidates: [
        { candidateId: `${row.regionId}-a`, votes: 10000 },
        { candidateId: `${row.regionId}-b`, votes: 20000 },
      ],
    }));
    const second = projectBgFoundingRunoff(renewed, nominations, first);
    const count = countBgFoundingElection(second);
    expect(count.kind).toBe("certified");
    expect(second.lists).toBe(first.lists);
    expect(count.lists).toEqual(countBgFoundingElection(first).lists);
    const people = new Map(nominations.people.map((row) => [row.id, row]));
    expect(
      Object.values(count.constituencyWinners).every((id) => people.get(id!)?.partyId === "b")
    ).toBe(true);
    expect(
      second.constituencies.every(
        (row) =>
          row.first === first.constituencies.find((original) => original.id === row.id)!.first
      )
    ).toBe(true);
    expect(second.constituencies.reduce((value, row) => value + row.second!.ballotsCast, 0)).toBe(
      150000
    );
  });
  it("zero renewed votes remain pending rather than seating fabricated runoff winners", () => {
    const { nominations, campaigns } = fixture();
    const low = campaigns.map((row) => ({
      ...row,
      candidates: row.candidates.map((candidate) => ({ ...candidate, votes: candidate.votes / 2 })),
    }));
    const first = projectBgFoundingBallots(low, nominations);
    const empty = campaigns.map((row) => ({
      ...row,
      candidates: row.candidates.map((candidate) => ({ ...candidate, votes: 0 })),
    }));
    expect(
      countBgFoundingElection(projectBgFoundingRunoff(empty, nominations, first)).unresolved
    ).toHaveLength(200);
  });
  it("refuses duplicate streams, cross-region support, overflowing turnout and changed runoff registers", () => {
    const { nominations, campaigns } = fixture();
    const first = projectBgFoundingBallots(campaigns, nominations);
    expect(() => projectBgFoundingBallots(campaigns.slice(1), nominations)).toThrow("five regions");
    const duplicate = campaigns.map((row, index) =>
      index ? row : { ...row, candidates: [...row.candidates, row.candidates[0]] }
    );
    expect(() => projectBgFoundingBallots(duplicate, nominations)).toThrow("campaign support");
    const excess = campaigns.map((row) => ({
      ...row,
      candidates: row.candidates.map((candidate) => ({ ...candidate, listVotes: 100000 })),
    }));
    expect(() => projectBgFoundingBallots(excess, nominations)).toThrow("turnout");
    const low = campaigns.map((row) => ({
      ...row,
      candidates: row.candidates.map((candidate) => ({ ...candidate, votes: 10000 })),
    }));
    const pending = projectBgFoundingBallots(low, nominations);
    expect(() =>
      projectBgFoundingRunoff(
        low.map((row) => ({ ...row, registeredVoters: 200000 })),
        nominations,
        pending
      )
    ).toThrow("frozen constituency register");
    expect(() =>
      countBgFoundingElection({ ...first, constituencies: first.constituencies.slice(1) })
    ).toThrow("all200");
  });
});
