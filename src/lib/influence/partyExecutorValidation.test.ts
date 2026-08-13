import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import type { NPP, PoliticalParty } from "@/lib/db/types";
import type { StatePartyOrg } from "@/lib/db/types";
import {
  validateNationalPartyInfluence,
  validateStatePartyInfluence,
} from "./partyExecutorValidation";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));

describe("validateNationalPartyInfluence", () => {
  let db: MockDb;
  let actorCharacterId: ObjectId;
  let userId: ObjectId;
  let party: PoliticalParty;
  let npp: NPP;

  beforeEach(async () => {
    db = createMockDb();
    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
    db.collection("characters");
    db.collection("users");
    db.collection("states");
    db.collection("electionCandidates");

    actorCharacterId = new ObjectId();
    userId = new ObjectId();
    party = {
      _id: new ObjectId(),
      sequentialId: 1,
      countryId: "US",
      name: "Democratic Party",
      chairId: actorCharacterId,
      viceChairId: null,
      politicalStrength: 20,
      treasury: 500000,
    } as PoliticalParty;
    npp = {
      _id: new ObjectId(),
      name: "Latoya O'Connor",
      countryId: "US",
      homeState: "AK",
      party: "1",
      favorability: 55,
      politicalInfluence: 10,
      currentOffice: null,
      retiredAt: null,
      personality: { loyalty: 60, ambition: 50, stubbornness: 35 },
      policies: { economic: 0, social: 0 },
      generatedAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    } as NPP;

    db.collectionMocks.characters.findOne.mockResolvedValue({
      _id: actorCharacterId,
      userId,
    });
    db.collectionMocks.users.findOne.mockResolvedValue({
      _id: userId,
      isAdmin: false,
    });
    db.collectionMocks.states.findOne.mockResolvedValue({
      _id: "TX",
      name: "Texas",
      countryId: "US",
    });
    db.collectionMocks.electionCandidates.findOne.mockResolvedValue(null);
    db.collection("statePartyOrg");
    db.collection("npps");
    db.collectionMocks.statePartyOrg.findOne.mockResolvedValue(null);
    db.collectionMocks.npps.countDocuments.mockResolvedValue(0);
  });

  it("requires a target state when requesting relocation", async () => {
    const result = await validateNationalPartyInfluence(
      party,
      npp,
      "relocate_state",
      0,
      actorCharacterId,
      {}
    );

    expect(result).toEqual({
      valid: false,
      error: "Select a target state for this relocation request.",
    });
  });

  it("allows relocation even when the NPP currently holds office", async () => {
    npp.currentOffice = { type: "governor", state: "AK" };

    const result = await validateNationalPartyInfluence(
      party,
      npp,
      "relocate_state",
      0,
      actorCharacterId,
      { targetStateId: "TX" }
    );

    expect(result).toEqual({ valid: true });
  });

  it("allows relocation even when the NPP is still an active candidate", async () => {
    db.collectionMocks.electionCandidates.findOne.mockResolvedValue({
      _id: new ObjectId(),
      nppId: npp._id,
      status: "active",
    });

    const result = await validateNationalPartyInfluence(
      party,
      npp,
      "relocate_state",
      0,
      actorCharacterId,
      { targetStateId: "TX" }
    );

    expect(result).toEqual({ valid: true });
  });

  it("allows valid relocation requests from national party leadership", async () => {
    const result = await validateNationalPartyInfluence(
      party,
      npp,
      "relocate_state",
      0,
      actorCharacterId,
      { targetStateId: "TX" }
    );

    expect(result).toEqual({ valid: true });
  });

  it("rejects relocation when the target region is at NPP capacity for a small party", async () => {
    db.collectionMocks.statePartyOrg.findOne.mockResolvedValue({
      _id: "TX_1",
      stateId: "TX",
      partyId: "1",
      organization: 0,
    });
    // Order of the Promise.all: target-region NPP count, region count, party-wide
    // NPP count. Two NPPs nationwide across 50 regions leaves the recruitment
    // floor of 2 as the binding cap, and the target already holds both.
    db.collectionMocks.npps.countDocuments.mockResolvedValueOnce(2).mockResolvedValueOnce(2);
    db.collectionMocks.states.countDocuments.mockResolvedValue(50);

    const result = await validateNationalPartyInfluence(
      party,
      npp,
      "relocate_state",
      0,
      actorCharacterId,
      { targetStateId: "TX" }
    );

    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/Texas is at capacity for your party \(2\/2 politicians\)/);
  });

  // Regression for #3833: a seeded roster (the UK 1953 sandbox) puts dozens of a
  // party's NPPs in every region, so the recruitment growth cap of 2-5 made EVERY
  // region read as full and relocation impossible. Relocation is net-zero
  // nationally and must scale with the roster the party actually has.
  it("allows relocation into a busy region when the party has a large seeded roster", async () => {
    db.collectionMocks.statePartyOrg.findOne.mockResolvedValue({
      _id: "TX_1",
      stateId: "TX",
      partyId: "1",
      organization: 0,
    });
    db.collectionMocks.npps.countDocuments
      .mockResolvedValueOnce(30) // already in the target region
      .mockResolvedValueOnce(400); // party-wide
    db.collectionMocks.states.countDocuments.mockResolvedValue(12);

    const result = await validateNationalPartyInfluence(
      party,
      npp,
      "relocate_state",
      0,
      actorCharacterId,
      { targetStateId: "TX" }
    );

    expect(result).toEqual({ valid: true });
  });

  it("still refuses a region stacked far past the party's fair national share", async () => {
    db.collectionMocks.statePartyOrg.findOne.mockResolvedValue({
      _id: "TX_1",
      stateId: "TX",
      partyId: "1",
      organization: 0,
    });
    db.collectionMocks.npps.countDocuments
      .mockResolvedValueOnce(60) // target region
      .mockResolvedValueOnce(400); // party-wide, 12 regions -> cap 50
    db.collectionMocks.states.countDocuments.mockResolvedValue(12);

    const result = await validateNationalPartyInfluence(
      party,
      npp,
      "relocate_state",
      0,
      actorCharacterId,
      { targetStateId: "TX" }
    );

    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/Texas is at capacity for your party \(60\/50 politicians\)/);
  });

  it("allows relocation when the target state has a free slot at high organization", async () => {
    db.collectionMocks.statePartyOrg.findOne.mockResolvedValue({
      _id: "TX_1",
      stateId: "TX",
      partyId: "1",
      organization: 75,
    });
    db.collectionMocks.npps.countDocuments.mockResolvedValue(4);

    const result = await validateNationalPartyInfluence(
      party,
      npp,
      "relocate_state",
      0,
      actorCharacterId,
      { targetStateId: "TX" }
    );

    expect(result).toEqual({ valid: true });
  });

  it("rejects boost_favorability when target NPP is at the favorability cap", async () => {
    npp.favorability = 100;
    const result = await validateNationalPartyInfluence(
      party,
      npp,
      "boost_favorability",
      0,
      actorCharacterId,
      {}
    );
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/already.*max/i);
  });

  it("rejects boost_influence when target NPP is at the influence cap", async () => {
    npp.politicalInfluence = 100;
    const result = await validateNationalPartyInfluence(
      party,
      npp,
      "boost_influence",
      0,
      actorCharacterId,
      {}
    );
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/already.*max/i);
  });

  it("allows a confirmed national campaigner to use NPP management (ticket 1067)", async () => {
    const campaignerId = new ObjectId();
    party.chairId = new ObjectId();
    party.viceChairId = new ObjectId();
    party.campaignerIds = [campaignerId];
    db.collectionMocks.characters.findOne.mockResolvedValue({
      _id: campaignerId,
      userId,
    });

    const result = await validateNationalPartyInfluence(
      party,
      npp,
      "boost_favorability",
      0,
      campaignerId,
      {}
    );

    expect(result).toEqual({ valid: true });
  });

  it("still rejects a party member who is not chair, vice, or campaigner", async () => {
    const outsiderId = new ObjectId();
    party.chairId = new ObjectId();
    party.viceChairId = new ObjectId();
    party.campaignerIds = [];
    db.collectionMocks.characters.findOne.mockResolvedValue({
      _id: outsiderId,
      userId,
    });

    const result = await validateNationalPartyInfluence(
      party,
      npp,
      "boost_favorability",
      0,
      outsiderId,
      {}
    );

    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/confirmed campaigner/i);
  });

  it("still allows boost_favorability when fav is 99", async () => {
    npp.favorability = 99;
    const result = await validateNationalPartyInfluence(
      party,
      npp,
      "boost_favorability",
      0,
      actorCharacterId,
      {}
    );
    expect(result.valid).toBe(true);
  });
});

describe("validateStatePartyInfluence", () => {
  let db: MockDb;
  let actorCharacterId: ObjectId;
  let userId: ObjectId;
  let statePartyOrg: StatePartyOrg;
  let npp: NPP;

  beforeEach(async () => {
    db = createMockDb();
    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
    db.collection("characters");
    db.collection("users");
    db.collection("electionCandidates");

    actorCharacterId = new ObjectId();
    userId = new ObjectId();
    statePartyOrg = {
      _id: { stateId: "AK", partyId: "1" },
      stateId: "AK",
      partyId: "1",
      countryId: "US",
      chairId: actorCharacterId,
      viceChairId: null,
      treasurerId: null,
      politicalStrength: 30,
      treasury: 200000,
    } as unknown as StatePartyOrg;
    npp = {
      _id: new ObjectId(),
      name: "Maxed NPP",
      countryId: "US",
      homeState: "AK",
      party: "1",
      favorability: 100,
      politicalInfluence: 80,
      currentOffice: null,
      retiredAt: null,
      personality: { loyalty: 60, ambition: 50, stubbornness: 35 },
      policies: { economic: 0, social: 0 },
      generatedAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    } as NPP;

    db.collectionMocks.characters.findOne.mockResolvedValue({
      _id: actorCharacterId,
      userId,
    });
    db.collectionMocks.users.findOne.mockResolvedValue({
      _id: userId,
      isAdmin: false,
    });
    db.collectionMocks.electionCandidates.findOne.mockResolvedValue(null);
  });

  it("rejects boost_favorability when target NPP favorability is at the cap", async () => {
    const result = await validateStatePartyInfluence(
      statePartyOrg,
      npp,
      "boost_favorability",
      0,
      actorCharacterId,
      {}
    );
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/already.*max/i);
  });

  it("rejects boost_influence when target NPP politicalInfluence is at the cap", async () => {
    npp.favorability = 70;
    npp.politicalInfluence = 100;
    const result = await validateStatePartyInfluence(
      statePartyOrg,
      npp,
      "boost_influence",
      0,
      actorCharacterId,
      {}
    );
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/already.*max/i);
  });

  it("rejects boost_loyalty when target NPP loyalty is at the cap", async () => {
    npp.favorability = 70;
    npp.politicalInfluence = 50;
    npp.personality.loyalty = 100;
    const result = await validateStatePartyInfluence(
      statePartyOrg,
      npp,
      "boost_loyalty",
      0,
      actorCharacterId,
      {}
    );
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/loyalty.*already.*max/i);
  });

  it("rejects reduce_stubbornness when target NPP stubbornness is at the floor", async () => {
    npp.favorability = 70;
    npp.politicalInfluence = 50;
    npp.personality.stubbornness = 0;
    const result = await validateStatePartyInfluence(
      statePartyOrg,
      npp,
      "reduce_stubbornness",
      0,
      actorCharacterId,
      {}
    );
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/stubbornness.*already.*floor/i);
  });

  it("still allows boost_loyalty when loyalty is 99 (room to grow)", async () => {
    npp.favorability = 70;
    npp.politicalInfluence = 50;
    npp.personality.loyalty = 99;
    const result = await validateStatePartyInfluence(
      statePartyOrg,
      npp,
      "boost_loyalty",
      0,
      actorCharacterId,
      {}
    );
    expect(result.valid).toBe(true);
  });

  it("still allows reduce_stubbornness when stubbornness is 1 (room to fall)", async () => {
    npp.favorability = 70;
    npp.politicalInfluence = 50;
    npp.personality.stubbornness = 1;
    const result = await validateStatePartyInfluence(
      statePartyOrg,
      npp,
      "reduce_stubbornness",
      0,
      actorCharacterId,
      {}
    );
    expect(result.valid).toBe(true);
  });
});
