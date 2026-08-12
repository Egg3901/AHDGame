import { describe, it, expect } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createMockDb } from "@/lib/test-utils/mockDb";
import { getNationalBillDetail, listNationalLegislatureBills } from "./nationalBillQueries";

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

describe("listNationalLegislatureBills — chamber tabs", () => {
  it("lists a concurrent bill in the upper chamber's tab and keeps the UK country scope", async () => {
    const db = createMockDb();
    db.collection("bills");
    // The function calls bills.find twice with different chains — the paged list
    // (project/sort/skip/limit) and a flat provisions scan.
    db.collectionMocks["bills"]!.find.mockReturnValue({
      toArray: async () => [],
      project: () => ({
        sort: () => ({ skip: () => ({ limit: () => ({ toArray: async () => [] }) }) }),
      }),
    });
    db.collectionMocks["bills"]!.countDocuments.mockResolvedValue(0);
    for (const name of ["politicalParties", "legislationTypes", "electedOfficials"]) {
      db.collection(name);
      db.collectionMocks[name]!.find.mockReturnValue({ toArray: async () => [] });
    }

    await listNationalLegislatureBills(db as unknown as Db, {
      countryId: "UK",
      chamber: "lords",
      authUser: { isAdmin: true, userId: new ObjectId().toString() } as never,
    });

    const filter = db.collectionMocks["bills"]!.find.mock.calls[0]![0] as Record<string, unknown>;
    const clause = (filter.$and as { $or: Record<string, unknown>[] }[])[0]!.$or;
    // The upper chamber's tab must reach a bill whose currentChamber is the lower one.
    expect(clause).toContainEqual({ status: "active_both" });
    expect(clause).toContainEqual({ currentChamber: "lords" });
    // ...without displacing the UK scope, which is itself an $or on the same object.
    expect(filter.$or).toBeDefined();
  });
});

describe("getNationalBillDetail — concurrent bicameral vote", () => {
  it("scopes the second tally to the upper chamber, not to currentChamber", async () => {
    const senatorFor = new ObjectId();
    const senatorAgainst = new ObjectId();
    const billId = new ObjectId();

    // A concurrent bill carries the LOWER chamber in `currentChamber` — a display
    // default. Scoping the second tally by it resolves to house officials, matches
    // no senator, and empties the upper-chamber result the Senate just voted.
    const bill = {
      _id: billId,
      countryId: "US",
      title: "Join the Conflict",
      summary: "Both chambers vote at once",
      status: "active_both",
      originChamber: "house",
      currentChamber: "house",
      sponsorId: new ObjectId(),
      sponsorName: "Jo",
      sponsorParty: "1",
      coSponsors: [],
      votesFor: 0,
      votesAgainst: 0,
      votesAbstain: 0,
      votes: {},
      // Stored aggregates deliberately wrong so a fallback cannot masquerade as a pass.
      otherChamberVotesFor: 999,
      otherChamberVotesAgainst: 999,
      otherChamberVotesAbstain: 0,
      otherChamberVotes: {
        [senatorFor.toString()]: "for",
        [senatorAgainst.toString()]: "against",
      },
      proposedAt: new Date("2026-08-10T00:00:00Z"),
    };

    const db = createMockDb();
    db.collection("bills");
    db.collection("electedOfficials");
    db.collectionMocks["bills"]!.findOne.mockResolvedValue(bill);
    db.collectionMocks["electedOfficials"]!.find.mockReturnValue({
      project: () => ({
        toArray: async () => [
          {
            characterId: senatorFor,
            nppId: null,
            officeType: "senate",
            countryId: "US",
            seatsHeld: 1,
          },
          {
            characterId: senatorAgainst,
            nppId: null,
            officeType: "senate",
            countryId: "US",
            seatsHeld: 1,
          },
        ],
      }),
    });

    const detail = await getNationalBillDetail(db as unknown as Db, billId.toString(), null);

    expect(detail).not.toBeNull();
    expect(detail!.otherChamberVotesFor).toBe(1);
    expect(detail!.otherChamberVotesAgainst).toBe(1);
  });
});
