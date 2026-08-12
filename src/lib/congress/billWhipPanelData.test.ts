import { describe, expect, it } from "vitest";
import { ObjectId } from "mongodb";
import { createMockDb } from "@/lib/test-utils/mockDb";
import type { Bill, BillWhip, PoliticalParty } from "@/lib/db/types";
import { buildBillWhipPanelData } from "./billWhipPanelData";

describe("buildBillWhipPanelData", () => {
  it("returns player and NPP whip summaries for eligible national party leaders", async () => {
    const db = createMockDb();
    const chairId = new ObjectId();
    const billId = new ObjectId();
    db.collection("politicalParties");
    db.collection("electedOfficials");
    db.collection("billWhips");

    const party: PoliticalParty = {
      _id: new ObjectId(),
      sequentialId: 1,
      countryId: "US",
      name: "Test Party",
      abbreviation: "TP",
      color: "#123456",
      economicPosition: 0,
      socialPosition: 0,
      chairId,
      viceChairId: null,
      treasurerId: null,
      committeeIds: [],
      memberCount: 10,
      isDefault: false,
      createdBy: null,
      treasury: 0,
      nationalTaxRate: 0,
      politicalStrength: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const bill: Bill = {
      _id: billId,
      title: "Test Bill",
      summary: "Summary",
      originChamber: "house",
      currentChamber: "house",
      sponsorId: null,
      sponsorName: "Sponsor",
      sponsorParty: "1",
      status: "active",
      votesFor: 0,
      votesAgainst: 0,
      votesAbstain: 0,
      votes: {},
      countryId: "US",
      proposedAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const whips: BillWhip[] = [
      {
        _id: new ObjectId(),
        targetType: "bill",
        targetId: billId,
        chamber: "house",
        direction: "for",
        issuedBy: "nationalParty",
        countryId: "US",
        partyId: "1",
        issuedByCharacterId: chairId,
        audience: "character",
        attemptNumber: 1,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        _id: new ObjectId(),
        targetType: "bill",
        targetId: billId,
        chamber: "house",
        direction: "against",
        issuedBy: "nationalParty",
        countryId: "US",
        partyId: "1",
        issuedByCharacterId: chairId,
        audience: "npp",
        attemptNumber: 1,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ];

    db.collectionMocks["politicalParties"]!.findOne.mockResolvedValue(party);
    db.collectionMocks["electedOfficials"]!.find.mockReturnValue({
      project: () => ({
        toArray: async () => [{ officeType: "house" }],
      }),
    });
    db.collectionMocks["billWhips"]!.find.mockReturnValue({
      toArray: async () => whips,
    });

    const panel = await buildBillWhipPanelData(db as never, bill, "US", {
      characterId: chairId,
      partyId: "1",
      viewerCountryId: "US",
      isAdmin: false,
    });

    expect(panel).toEqual({
      party: {
        id: "1",
        name: "Test Party",
        color: "#123456",
      },
      chambers: [
        {
          chamberKey: "house",
          chamberLabel: "House",
          playerWhip: {
            existingWhips: [{ direction: "for", attemptNumber: 1, issuedByRole: "Chair" }],
            canWhip: false,
          },
          nppWhip: {
            existingWhips: [{ direction: "against", attemptNumber: 1, issuedByRole: "Chair" }],
            canWhip: true,
          },
        },
      ],
    });
  });

  it("renders the CN whip panel for an npcDelegate (chamber key 'npc' → office 'npcDelegate')", async () => {
    const db = createMockDb();
    const chairId = new ObjectId();
    const billId = new ObjectId();
    db.collection("politicalParties");
    db.collection("electedOfficials");
    db.collection("billWhips");

    db.collectionMocks["politicalParties"]!.findOne.mockResolvedValue({
      _id: new ObjectId(),
      sequentialId: 1,
      countryId: "CN",
      name: "CCP",
      abbreviation: "CCP",
      color: "#cc0000",
      economicPosition: 0,
      socialPosition: 0,
      chairId,
      viceChairId: null,
      treasurerId: null,
      committeeIds: [],
      memberCount: 10,
      isDefault: false,
      createdBy: null,
      treasury: 0,
      nationalTaxRate: 0,
      politicalStrength: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    } satisfies PoliticalParty);

    const bill: Bill = {
      _id: billId,
      title: "Public Security Act",
      summary: "Summary",
      originChamber: "npc",
      currentChamber: "npc",
      sponsorId: null,
      sponsorName: "Sponsor",
      sponsorParty: "1",
      status: "active",
      votesFor: 0,
      votesAgainst: 0,
      votesAbstain: 0,
      votes: {},
      countryId: "CN",
      proposedAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    // Live storage: CN delegates carry officeType "npcDelegate".
    db.collectionMocks["electedOfficials"]!.find.mockReturnValue({
      project: () => ({
        toArray: async () => [{ officeType: "npcDelegate" }],
      }),
    });
    db.collectionMocks["billWhips"]!.find.mockReturnValue({
      toArray: async () => [],
    });

    const panel = await buildBillWhipPanelData(db as never, bill, "CN", {
      characterId: chairId,
      partyId: "1",
      viewerCountryId: "CN",
      isAdmin: false,
    });

    expect(panel).not.toBeNull();
    expect(panel!.chambers).toHaveLength(1);
    expect(panel!.chambers[0]!.chamberKey).toBe("npc");

    // The legislator lookup must resolve to the office type and stay country-scoped.
    const officialsFilter = db.collectionMocks["electedOfficials"]!.find.mock.calls[0]![0] as {
      officeType?: { $in?: string[] };
      countryId?: string;
    };
    expect(officialsFilter.officeType?.$in).toContain("npcDelegate");
    expect(officialsFilter.countryId).toBe("CN");
  });

  it("returns null for viewers who are not chair, vice chair, or admin", async () => {
    const db = createMockDb();
    const billId = new ObjectId();
    const viewerId = new ObjectId();
    db.collection("politicalParties");

    db.collectionMocks["politicalParties"]!.findOne.mockResolvedValue({
      _id: new ObjectId(),
      sequentialId: 1,
      countryId: "US",
      name: "Test Party",
      abbreviation: "TP",
      color: "#123456",
      economicPosition: 0,
      socialPosition: 0,
      chairId: new ObjectId(),
      viceChairId: null,
      treasurerId: null,
      committeeIds: [],
      memberCount: 10,
      isDefault: false,
      createdBy: null,
      treasury: 0,
      nationalTaxRate: 0,
      politicalStrength: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    } satisfies PoliticalParty);

    const bill: Bill = {
      _id: billId,
      title: "Test Bill",
      summary: "Summary",
      originChamber: "house",
      currentChamber: "house",
      sponsorId: null,
      sponsorName: "Sponsor",
      status: "active",
      votesFor: 0,
      votesAgainst: 0,
      votesAbstain: 0,
      votes: {},
      countryId: "US",
      proposedAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const panel = await buildBillWhipPanelData(db as never, bill, "US", {
      characterId: viewerId,
      partyId: "1",
      viewerCountryId: "US",
      isAdmin: false,
    });

    expect(panel).toBeNull();
  });

  it("returns null for a viewer whose country differs from the bill's country (sequentialId collision)", async () => {
    const db = createMockDb();
    const billId = new ObjectId();
    const viewerId = new ObjectId();
    db.collection("politicalParties");

    // A CN viewer is chair of CN party seqId 1; the US bill's party table also
    // has a seqId 1. Without the country guard, the panel would resolve the CN
    // viewer against the US party and render. The guard must short-circuit
    // before any party lookup.
    db.collectionMocks["politicalParties"]!.findOne.mockResolvedValue({
      _id: new ObjectId(),
      sequentialId: 1,
      countryId: "US",
      name: "US Democratic Party",
      abbreviation: "D",
      color: "#0000ff",
      economicPosition: 0,
      socialPosition: 0,
      chairId: viewerId,
      viceChairId: null,
      treasurerId: null,
      committeeIds: [],
      memberCount: 10,
      isDefault: false,
      createdBy: null,
      treasury: 0,
      nationalTaxRate: 0,
      politicalStrength: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    } satisfies PoliticalParty);

    const bill: Bill = {
      _id: billId,
      title: "US Bill",
      summary: "Summary",
      originChamber: "house",
      currentChamber: "house",
      sponsorId: null,
      sponsorName: "Sponsor",
      status: "active",
      votesFor: 0,
      votesAgainst: 0,
      votesAbstain: 0,
      votes: {},
      countryId: "US",
      proposedAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const panel = await buildBillWhipPanelData(db as never, bill, "US", {
      characterId: viewerId,
      partyId: "1",
      viewerCountryId: "CN",
      isAdmin: false,
    });

    expect(panel).toBeNull();
    expect(db.collectionMocks["politicalParties"]!.findOne).not.toHaveBeenCalled();
  });

  it("opens both chambers on a concurrent bill, not just the display currentChamber", async () => {
    const db = createMockDb();
    const chairId = new ObjectId();
    const billId = new ObjectId();
    db.collection("politicalParties");
    db.collection("electedOfficials");
    db.collection("billWhips");

    db.collectionMocks["politicalParties"]!.findOne.mockResolvedValue({
      _id: new ObjectId(),
      sequentialId: 1,
      countryId: "US",
      name: "Test Party",
      abbreviation: "TP",
      color: "#123456",
      economicPosition: 0,
      socialPosition: 0,
      chairId,
      viceChairId: null,
      treasurerId: null,
      committeeIds: [],
      memberCount: 10,
      isDefault: false,
      createdBy: null,
      treasury: 0,
      nationalTaxRate: 0,
      politicalStrength: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    } satisfies PoliticalParty);

    // `currentChamber` is the lower house on every concurrent bill — a display
    // default, not the authority. Filtering on it leaves the Senate with no whip
    // panel at all while the whip routes happily accept Senate votes.
    const bill: Bill = {
      _id: billId,
      title: "Join the Conflict",
      summary: "Summary",
      originChamber: "house",
      currentChamber: "house",
      sponsorId: null,
      sponsorName: "Sponsor",
      sponsorParty: "1",
      status: "active_both",
      votesFor: 0,
      votesAgainst: 0,
      votesAbstain: 0,
      votes: {},
      countryId: "US",
      proposedAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    db.collectionMocks["electedOfficials"]!.find.mockReturnValue({
      project: () => ({
        toArray: async () => [{ officeType: "house" }, { officeType: "senate" }],
      }),
    });
    db.collectionMocks["billWhips"]!.find.mockReturnValue({ toArray: async () => [] });

    const panel = await buildBillWhipPanelData(db as never, bill, "US", {
      characterId: chairId,
      partyId: "1",
      viewerCountryId: "US",
      isAdmin: false,
    });

    expect(panel).not.toBeNull();
    expect(panel!.chambers.map((c) => c.chamberKey)).toEqual(["house", "senate"]);
  });
});
