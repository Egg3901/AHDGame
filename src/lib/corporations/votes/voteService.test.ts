import { describe, it, expect } from "vitest";
import { ObjectId, type Db } from "mongodb";
import {
  computeVoteOutcome,
  checkAutoResolve,
  fundDirectionsFrom,
  resolveCorporationVoteIfReady,
} from "./voteService";
import type { CorporationVote } from "@/lib/db/types/corporationVote";
import { createMockDb } from "@/lib/test-utils/mockDb";

describe("computeVoteOutcome", () => {
  it("passes when yesShares meets threshold of all shares", () => {
    expect(
      computeVoteOutcome({ yesShares: 50, totalEligibleShares: 100, passThreshold: 0.5 })
    ).toBe("passed");
  });
  it("fails when yesShares below threshold", () => {
    expect(
      computeVoteOutcome({ yesShares: 49, totalEligibleShares: 100, passThreshold: 0.5 })
    ).toBe("failed");
  });
  it("uses ceil so threshold rounds up", () => {
    // 0.62 × 100 = 62 required; 61 fails, 62 passes
    expect(
      computeVoteOutcome({ yesShares: 61, totalEligibleShares: 100, passThreshold: 0.62 })
    ).toBe("failed");
    expect(
      computeVoteOutcome({ yesShares: 62, totalEligibleShares: 100, passThreshold: 0.62 })
    ).toBe("passed");
  });
});

describe("checkAutoResolve", () => {
  it("returns passed when yes is already certain", () => {
    // 50% threshold, 100 shares; 60 yes, 10 no → 30 remain; even if all 30 vote no: 60≥50 → passes
    expect(
      checkAutoResolve({
        yesShares: 60,
        noShares: 10,
        totalEligibleShares: 100,
        passThreshold: 0.5,
      })
    ).toBe("passed");
  });
  it("returns failed when yes is mathematically impossible", () => {
    // 0.62 threshold, 100 shares; 10 yes, 40 no → max possible yes = 10+50 = 60 < 62 → impossible
    expect(
      checkAutoResolve({
        yesShares: 10,
        noShares: 40,
        totalEligibleShares: 100,
        passThreshold: 0.62,
      })
    ).toBe("failed");
  });
  it("returns open when still uncertain", () => {
    expect(
      checkAutoResolve({
        yesShares: 20,
        noShares: 10,
        totalEligibleShares: 100,
        passThreshold: 0.5,
      })
    ).toBe("open");
  });
});

describe("fundDirectionsFrom", () => {
  it("keys instructions by fund id", () => {
    const fundA = new ObjectId();
    const fundB = new ObjectId();
    const vote = {
      fundDirections: [
        { fundId: fundA, directorCharacterId: new ObjectId(), vote: "yes", castAt: new Date() },
        { fundId: fundB, directorCharacterId: new ObjectId(), vote: "no", castAt: new Date() },
      ],
    } as unknown as CorporationVote;
    const map = fundDirectionsFrom(vote);
    expect(map.get(fundA.toString())?.vote).toBe("yes");
    expect(map.get(fundB.toString())?.vote).toBe("no");
  });

  it("takes the last instruction per fund, so a director can change their mind", () => {
    const fundA = new ObjectId();
    const vote = {
      fundDirections: [
        { fundId: fundA, directorCharacterId: new ObjectId(), vote: "yes", castAt: new Date() },
        { fundId: fundA, directorCharacterId: new ObjectId(), vote: "no", castAt: new Date() },
      ],
    } as unknown as CorporationVote;
    expect(fundDirectionsFrom(vote).get(fundA.toString())?.vote).toBe("no");
  });

  it("is empty for a vote created before fund direction shipped", () => {
    expect(fundDirectionsFrom({} as unknown as CorporationVote).size).toBe(0);
  });
});

describe("resolveCorporationVoteIfReady", () => {
  it("invalidates stale ballot weights after the share structure changes", async () => {
    const db = createMockDb();
    const vote = {
      _id: new ObjectId(),
      corporationId: new ObjectId(),
      type: "share_issuance",
      proposedByCharacterId: new ObjectId(),
      proposedAtTurn: 262,
      deadlineAtTurn: 286,
      status: "open",
      passThreshold: 0.5,
      totalEligibleSharesAtOpen: 256_289_022,
      payload: { newShareCount: 128_144_511, issuancePrice: 13.28 },
      votes: [
        {
          characterId: new ObjectId(),
          voteShares: 3_076_330,
          vote: "yes",
          castAt: new Date("2026-08-20T14:22:03.446Z"),
        },
      ],
      createdAt: new Date("2026-08-20T14:21:55.074Z"),
      updatedAt: new Date("2026-08-20T14:22:03.446Z"),
    } as unknown as CorporationVote;

    const result = await resolveCorporationVoteIfReady({
      db: db as unknown as Db,
      vote,
      totalEligibleShares: 1_000_000,
      currentTurn: 262,
    });

    expect(result).toEqual({ outcome: "cancelled", claimed: true });
  });
});
