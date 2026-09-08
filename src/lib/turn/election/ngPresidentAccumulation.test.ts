import { describe, it, expect, vi } from "vitest";
import { ObjectId } from "mongodb";
import type { Db } from "mongodb";
import { createMockDb } from "@/lib/test-utils/mockDb";
import { accumulateNGPresidentVoteTurn } from "./ngPresidentAccumulation";
import { NG_ZONES } from "@/lib/nigeriaPresidentialElectionEngine";

vi.mock("@/lib/campaignTargeting/audience", () => ({ loadRegionalCampaignCells: vi.fn() }));

const NOW = new Date("1991-06-01T00:00:00Z");

describe("accumulateNGPresidentVoteTurn", () => {
  it("distributes per-zone votes by party org and writes all six zones", async () => {
    const db = createMockDb();
    const electionId = new ObjectId();
    const A = new ObjectId().toString(); // apc
    const B = new ObjectId().toString(); // pdp

    const tallies = db.collection("electionVoteTallies");
    tallies.findOne.mockResolvedValue({
      electionId,
      candidateParties: { [A]: "apc", [B]: "pdp" },
      totalVotes: {},
      totalVotesByUnit: {},
      finalized: false,
    });

    db.collection("states").find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue(NG_ZONES.map((z) => ({ _id: z, population: 1_000_000 }))),
    });

    // apc dominates NORTH_WEST; every other zone is an even 50/50 split.
    const orgRows: { countryId: string; stateId: string; partyId: string; organization: number }[] =
      NG_ZONES.flatMap((z) =>
        z === "NORTH_WEST"
          ? [
              { countryId: "NG", stateId: z as string, partyId: "apc", organization: 80 },
              { countryId: "NG", stateId: z as string, partyId: "pdp", organization: 20 },
            ]
          : [
              { countryId: "NG", stateId: z as string, partyId: "apc", organization: 50 },
              { countryId: "NG", stateId: z as string, partyId: "pdp", organization: 50 },
            ]
      );
    db.collection("statePartyOrg").find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue(orgRows),
    });

    await accumulateNGPresidentVoteTurn(db as unknown as Db, electionId, NOW);

    expect(tallies.updateOne).toHaveBeenCalledTimes(1);
    const set = tallies.updateOne.mock.calls[0][1].$set as {
      totalVotesByUnit: Record<string, Record<string, number>>;
      totalVotes: Record<string, number>;
    };

    // All six zones populated.
    for (const z of NG_ZONES) {
      expect(set.totalVotesByUnit[z]).toBeDefined();
      expect(set.totalVotesByUnit[z][A]).toBeGreaterThan(0);
    }
    // apc's org edge gives it more votes than pdp in NORTH_WEST...
    expect(set.totalVotesByUnit.NORTH_WEST[A]).toBeGreaterThan(set.totalVotesByUnit.NORTH_WEST[B]);
    // ...but the two tie in an even zone.
    expect(set.totalVotesByUnit.SOUTH_EAST[A]).toBe(set.totalVotesByUnit.SOUTH_EAST[B]);
    // National totals accumulate.
    expect(set.totalVotes[A]).toBeGreaterThan(set.totalVotes[B]);
  });

  it("does not bank the same turn twice when a stalled turn is re-run", async () => {
    const db = createMockDb();
    const electionId = new ObjectId();
    const tallies = db.collection("electionVoteTallies");
    tallies.findOne.mockResolvedValue({
      electionId,
      candidateParties: { a: "apc" },
      totalVotes: { a: 100 },
      totalVotesByUnit: {},
      finalized: false,
      lastAccruedTurn: 460,
    });

    // Turn 460 already banked: the re-run is a no-op.
    await accumulateNGPresidentVoteTurn(db as unknown as Db, electionId, NOW, 460);
    expect(tallies.updateOne).not.toHaveBeenCalled();

    // Turn 461 accrues and stamps itself.
    db.collection("states").find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue(NG_ZONES.map((z) => ({ _id: z, population: 1_000_000 }))),
    });
    db.collection("statePartyOrg").find.mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) });
    await accumulateNGPresidentVoteTurn(db as unknown as Db, electionId, NOW, 461);
    expect(tallies.updateOne).toHaveBeenCalledTimes(1);
    expect(tallies.updateOne.mock.calls[0][1].$set.lastAccruedTurn).toBe(461);
  });

  it("is a no-op once the tally is finalized", async () => {
    const db = createMockDb();
    const electionId = new ObjectId();
    const tallies = db.collection("electionVoteTallies");
    tallies.findOne.mockResolvedValue({ electionId, candidateParties: {}, finalized: true });

    await accumulateNGPresidentVoteTurn(db as unknown as Db, electionId, NOW);
    expect(tallies.updateOne).not.toHaveBeenCalled();
  });
});

it("applies standing ads only in the purchased zone without changing the ballot pool", async () => {
  const { loadRegionalCampaignCells } = await import("@/lib/campaignTargeting/audience");
  const db = createMockDb();
  const electionId = new ObjectId();
  const a = new ObjectId();
  const b = new ObjectId();
  const owner = new ObjectId();
  db.collection("electionVoteTallies").findOne.mockResolvedValue({
    electionId,
    candidateParties: { [a.toString()]: "a", [b.toString()]: "b" },
    totalVotes: {},
    totalVotesByUnit: {},
  });
  db.collection("states").find.mockReturnValue({
    toArray: async () =>
      NG_ZONES.map((zone) => ({ _id: zone, countryId: "NG", population: 1_000_000 })),
  });
  db.collection("electionCandidates").find.mockReturnValue({
    toArray: async () => [{ _id: a, characterId: owner }],
  });
  db.collection("characters").find.mockReturnValue({
    toArray: async () => [
      {
        _id: owner,
        policies: { economic: 0, social: 0 },
        targetedAds: [
          {
            stateId: "NORTH_WEST",
            dimension: "ethnicity",
            bucket: "group_a",
            exposure: 1,
            lastPurchaseTurn: 10,
            throughTurn: 10,
          },
        ],
      },
    ],
  });
  vi.mocked(loadRegionalCampaignCells).mockResolvedValue(
    new Map(
      NG_ZONES.map((zone) => [
        `NG:${zone}`,
        [
          {
            id: "cell",
            share: 1,
            turnout: 50,
            economicLean: 0,
            socialLean: 0,
            buckets: { ethnicity: "group_a" },
            identities: { ethnicity: { economicLean: 0, socialLean: 0 } },
          },
        ],
      ])
    )
  );
  await accumulateNGPresidentVoteTurn(db as unknown as Db, electionId, NOW, 10);
  const votes =
    db.collection("electionVoteTallies").updateOne.mock.calls[0][1].$set.totalVotesByUnit;
  expect(votes.NORTH_WEST[a.toString()]).toBeGreaterThan(votes.NORTH_WEST[b.toString()]);
  expect(votes.SOUTH_EAST[a.toString()]).toBe(votes.SOUTH_EAST[b.toString()]);
  for (const zone of NG_ZONES)
    expect(votes[zone][a.toString()] + votes[zone][b.toString()]).toBe(32000);
});
