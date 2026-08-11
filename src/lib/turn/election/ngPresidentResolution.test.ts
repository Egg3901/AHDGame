import { describe, expect, it, vi } from "vitest";
import { ObjectId } from "mongodb";
import type { Db } from "mongodb";
import type { Election, ElectionVoteTally } from "@/lib/db/types";
import { createMockDb } from "@/lib/test-utils/mockDb";
import {
  decideNGPresidentOutcome,
  resolveNGPresidentElection,
  type NGPresidentCandidate,
} from "./ngPresidentResolution";
import { seatPresidentialExecutive } from "@/lib/turn/election/presidentExecutiveSeating";
import { NG_ZONES } from "@/lib/nigeriaPresidentialElectionEngine";

vi.mock("@/lib/turn/election/presidentExecutiveSeating", () => ({
  seatPresidentialExecutive: vi.fn().mockResolvedValue(undefined),
}));

// Helper: build totalVotesByUnit (zone → candidateId → votes) from a
// candidate→[6 zone counts] map.
function units(per: Record<string, number[]>): Record<string, Record<string, number>> {
  const out: Record<string, Record<string, number>> = {};
  NG_ZONES.forEach((z, i) => {
    out[z] = {};
    for (const c in per) out[z][c] = per[c][i];
  });
  return out;
}

const CANDS: NGPresidentCandidate[] = [
  { id: "c_apc", party: "apc" },
  { id: "c_pdp", party: "pdp" },
  { id: "c_lp", party: "lp" },
];

describe("decideNGPresidentOutcome", () => {
  it("seats the national winner when the 4-zone spread is met", () => {
    const t = units({
      c_apc: [60, 60, 60, 60, 30, 30],
      c_pdp: [40, 40, 40, 40, 70, 70],
      c_lp: [0, 0, 0, 0, 0, 0],
    });
    const d = decideNGPresidentOutcome(CANDS, t);
    expect(d.outcome).toBe("won");
    if (d.outcome === "won") {
      expect(d.winnerPartyId).toBe("apc");
      expect(d.winnerCandidateId).toBe("c_apc");
    }
  });

  it("maps a winning party to its leading candidate", () => {
    // Two apc candidates; the one with more national votes is seated.
    const cands: NGPresidentCandidate[] = [
      { id: "c_apc1", party: "apc" },
      { id: "c_apc2", party: "apc" },
      { id: "c_pdp", party: "pdp" },
    ];
    const t = units({
      c_apc1: [50, 50, 50, 50, 20, 20],
      c_apc2: [10, 10, 10, 10, 10, 10],
      c_pdp: [40, 40, 40, 40, 70, 70],
    });
    const d = decideNGPresidentOutcome(cands, t);
    expect(d.outcome).toBe("won");
    if (d.outcome === "won") expect(d.winnerCandidateId).toBe("c_apc1");
  });

  it("returns a run-off of the top-two parties' nominees when spread fails", () => {
    // apc leads nationally but clears 25% in only 3 zones.
    const t = units({
      c_apc: [98, 98, 98, 2, 2, 2],
      c_pdp: [1, 1, 1, 60, 60, 60],
      c_lp: [1, 1, 1, 38, 38, 38],
    });
    const d = decideNGPresidentOutcome(CANDS, t);
    expect(d.outcome).toBe("runoff");
    if (d.outcome === "runoff") {
      expect(d.runoffCandidateIds).toHaveLength(2);
      expect(new Set(d.runoffCandidateIds)).toEqual(new Set(["c_apc", "c_pdp"]));
    }
  });

  it("is indeterminate on an empty tally", () => {
    expect(decideNGPresidentOutcome(CANDS, {}).outcome).toBe("indeterminate");
  });
});

describe("resolveNGPresidentElection (DB wrapper)", () => {
  const NOW = new Date("1991-08-01T00:00:00Z");
  const election = { _id: new ObjectId(), countryId: "NG", electionType: "president" } as Election;

  // Build totalVotesByUnit (zone → candidateId → votes) from per-zone counts.
  function units(per: Record<string, number[]>): Record<string, Record<string, number>> {
    const out: Record<string, Record<string, number>> = {};
    NG_ZONES.forEach((z, i) => {
      out[z] = {};
      for (const c in per) out[z][c] = per[c][i];
    });
    return out;
  }

  function setup(
    candidates: { id: ObjectId; party: string; runningMateId?: ObjectId }[],
    totalVotesByUnit: Record<string, Record<string, number>>,
    totalVotes: Record<string, number>
  ) {
    const db = createMockDb();
    db.collection("electionCandidates").find.mockReturnValue({
      toArray: vi
        .fn()
        .mockResolvedValue(
          candidates.map((c) => ({ _id: c.id, party: c.party, runningMateId: c.runningMateId }))
        ),
    });
    const tally = {
      candidateParties: Object.fromEntries(candidates.map((c) => [c.id.toString(), c.party])),
      totalVotes,
      totalVotesByUnit,
    } as unknown as ElectionVoteTally;
    return { db, tally };
  }

  it("seats the outright winner and finalizes the tally", async () => {
    vi.mocked(seatPresidentialExecutive).mockClear();
    const a = new ObjectId(); // apc
    const b = new ObjectId(); // pdp
    const mate = new ObjectId();
    const t = units({
      [a.toString()]: [60, 60, 60, 60, 40, 40],
      [b.toString()]: [40, 40, 40, 40, 60, 60],
    });
    const { db, tally } = setup(
      [
        { id: a, party: "apc", runningMateId: mate },
        { id: b, party: "pdp" },
      ],
      t,
      { [a.toString()]: 320, [b.toString()]: 280 }
    );

    const ok = await resolveNGPresidentElection(db as unknown as Db, election, tally, NOW);
    expect(ok).toBe(true);

    expect(seatPresidentialExecutive).toHaveBeenCalledTimes(1);
    const seatArg = vi.mocked(seatPresidentialExecutive).mock.calls[0][1];
    expect(seatArg.winnerCandidate._id).toBe(a);
    expect(seatArg.vpCharId).toBe(mate);

    const finalizeCall = db.collectionMocks["electionVoteTallies"]!.updateOne.mock.calls.find(
      (c) => c[1]?.$set?.finalized === true
    );
    expect(finalizeCall).toBeDefined();
  });

  it("seats the leading finalist when no party clears the zone spread", async () => {
    vi.mocked(seatPresidentialExecutive).mockClear();
    const a = new ObjectId(); // apc — leads nationally, only 3 zones
    const b = new ObjectId(); // pdp
    const c = new ObjectId(); // lp
    const t = units({
      [a.toString()]: [98, 98, 98, 2, 2, 2],
      [b.toString()]: [1, 1, 1, 60, 60, 60],
      [c.toString()]: [1, 1, 1, 38, 38, 38],
    });
    const { db, tally } = setup(
      [
        { id: a, party: "apc" },
        { id: b, party: "pdp" },
        { id: c, party: "lp" },
      ],
      t,
      { [a.toString()]: 300, [b.toString()]: 183, [c.toString()]: 117 }
    );

    const ok = await resolveNGPresidentElection(db as unknown as Db, election, tally, NOW);
    expect(ok).toBe(true);
    expect(seatPresidentialExecutive).toHaveBeenCalledTimes(1);
    // Leading finalist (apc, highest national vote of the top-two) is seated.
    expect(vi.mocked(seatPresidentialExecutive).mock.calls[0][1].winnerCandidate._id).toBe(a);
  });

  it("retries (no seat) when there are no zone votes yet", async () => {
    vi.mocked(seatPresidentialExecutive).mockClear();
    const a = new ObjectId();
    const { db, tally } = setup([{ id: a, party: "apc" }], {}, {});
    const ok = await resolveNGPresidentElection(db as unknown as Db, election, tally, NOW);
    expect(ok).toBe(false);
    expect(seatPresidentialExecutive).not.toHaveBeenCalled();
  });
});
