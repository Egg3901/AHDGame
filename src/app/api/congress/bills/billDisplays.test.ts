import { describe, it, expect } from "vitest";
import { ObjectId } from "mongodb";
import type { Bill } from "@/lib/db/types";
import { buildBillDisplays } from "./billDisplays";

describe("buildBillDisplays — voteShiftPreview", () => {
  const viewerId = new ObjectId();
  const bill = {
    _id: new ObjectId(),
    countryId: "US",
    title: "Public Works Act",
    summary: "Spend",
    status: "active",
    originChamber: "house",
    currentChamber: "house",
    sponsorId: new ObjectId(),
    sponsorName: "Jo",
    sponsorParty: "1",
    category: "economic",
    votesFor: 0,
    votesAgainst: 0,
    votesAbstain: 0,
    votes: {},
    provisions: [{ legislationTypeId: "lt-1", effectDirection: -1, economic: -3 }],
    proposedAt: new Date("2026-08-10T00:00:00Z"),
  } as unknown as Bill;

  it("carries a preview for a House member viewing an active House bill", () => {
    const [row] = buildBillDisplays([bill], {
      partyMap: new Map(),
      legislationTypeMap: new Map(),
      myVoteMap: new Map(),
      myCharacterId: viewerId.toString(),
      myChamber: "house",
      myPolicies: { economic: 1, social: 0 },
    });
    expect(row!.canVoteOrigin).toBe(true);
    expect(row!.voteShiftPreview).toEqual({
      current: { economic: 1, social: 0 },
      aye: { economic: -0.25, social: 0 },
      nay: { economic: 0.25, social: 0 },
    });
  });

  it("carries no preview for a senator who cannot vote on a House-stage bill", () => {
    const [row] = buildBillDisplays([bill], {
      partyMap: new Map(),
      legislationTypeMap: new Map(),
      myVoteMap: new Map(),
      myCharacterId: viewerId.toString(),
      myChamber: "senate",
      myPolicies: { economic: 1, social: 0 },
    });
    expect(row!.canVoteOrigin).toBe(false);
    expect(row!.voteShiftPreview ?? null).toBeNull();
  });
});
