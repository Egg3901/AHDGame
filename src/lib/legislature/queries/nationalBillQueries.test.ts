import { describe, it, expect } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createMockDb } from "@/lib/test-utils/mockDb";
import { getNationalBillDetail } from "./nationalBillQueries";

describe("getNationalBillDetail — frozen snapshot for concluded bills (#0982)", () => {
  it("uses the origin voteSnapshot for a signed bill instead of re-scoping to the new chamber", async () => {
    const charFor = new ObjectId();
    const charAgainst = new ObjectId();
    const charAbstain = new ObjectId();
    const billId = new ObjectId();

    const bill = {
      _id: billId,
      countryId: "US",
      title: "Signed Act",
      summary: "A concluded bill",
      status: "signed",
      originChamber: "house",
      currentChamber: "senate",
      sponsorId: new ObjectId(),
      sponsorName: "Jo",
      sponsorParty: "1",
      coSponsors: [],
      // Stored aggregate deliberately wrong to prove the snapshot wins.
      votesFor: 999,
      votesAgainst: 0,
      votesAbstain: 0,
      votes: {
        [charFor.toString()]: "for",
        [charAgainst.toString()]: "against",
        [charAbstain.toString()]: "abstain",
      },
      voteSnapshot: {
        // Self-consistent snapshot (totals derived from the weighted map).
        votes: {
          [charFor.toString()]: "for",
          [charAgainst.toString()]: "against",
          [charAbstain.toString()]: "abstain",
        },
        weights: {
          [charFor.toString()]: 260,
          [charAgainst.toString()]: 170,
          [charAbstain.toString()]: 5,
        },
        totals: { for: 260, against: 170, abstain: 5 },
        resolvedAtTurn: 12,
      },
      proposedAt: new Date("2026-06-07T00:00:00Z"),
    };

    const db = createMockDb();
    db.collection("bills");
    db.collectionMocks["bills"]!.findOne.mockResolvedValue(bill);
    // electedOfficials is left EMPTY on purpose: a live re-scope would find no
    // current holders and collapse the tally. The snapshot must override that.

    const detail = await getNationalBillDetail(db as unknown as Db, billId.toString(), null);

    expect(detail).not.toBeNull();
    // Frozen origin-chamber result, not the collapsed live scope nor the bad aggregate.
    expect(detail!.votesFor).toBe(260);
    expect(detail!.votesAgainst).toBe(170);
    expect(detail!.votesAbstain).toBe(5);
  });
});
