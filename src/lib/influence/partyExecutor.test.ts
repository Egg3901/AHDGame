import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId } from "mongodb";
import type { Db } from "mongodb";
import { createMockDb, getAccessedCollections, type MockDb } from "@/lib/test-utils/mockDb";
import type { NPP, PoliticalParty, StatePartyOrg } from "@/lib/db/types";
import {
  executeNationalPartyInfluence,
  executeStatePartyInfluence,
  getNationalPartyInfluenceOptions,
  getStatePartyInfluenceOptions,
} from "./partyExecutor";
import { calculatePartyInfluenceChance } from "./partyExecutorCalculations";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));

describe("getNationalPartyInfluenceOptions", () => {
  let db: MockDb;

  beforeEach(async () => {
    db = createMockDb();
    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
    db.collection("states");
    db.collection("npps");
    db.collection("statePartyOrg");
  });

  it("includes same-party NPPs from states that also have player members", async () => {
    const party = {
      _id: new ObjectId(),
      sequentialId: 1,
      countryId: "US",
      name: "Democratic Party",
      treasury: 500000,
      politicalStrength: 20,
    } as PoliticalParty;

    db.collectionMocks.states.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([
        { _id: "CA", name: "California", countryId: "US" },
        { _id: "TX", name: "Texas", countryId: "US" },
      ]),
    });
    db.collectionMocks.npps.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([
        {
          _id: new ObjectId(),
          name: "Alex NPP",
          party: "1",
          homeState: "CA",
          retiredAt: null,
          favorability: 55,
          politicalInfluence: 12,
          personality: { loyalty: 60, ambition: 45, stubbornness: 35 },
        },
        {
          _id: new ObjectId(),
          name: "Taylor NPP",
          party: "1",
          homeState: "TX",
          retiredAt: null,
          favorability: 48,
          politicalInfluence: 9,
          personality: { loyalty: 52, ambition: 50, stubbornness: 40 },
        },
      ]),
      project: vi.fn().mockReturnThis(),
    });
    db.collectionMocks.statePartyOrg.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([]),
    });

    const options = await getNationalPartyInfluenceOptions(party);

    expect(options.nppsByState.CA).toHaveLength(1);
    expect(options.nppsByState.TX).toHaveLength(1);
    expect(options.stateNames).toEqual({
      CA: "California",
      TX: "Texas",
    });
    expect(options.targetStates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "CA", actionCost: 1, fundCost: 0 }),
        expect.objectContaining({ id: "TX", actionCost: 1, fundCost: 0 }),
      ])
    );
    expect(getAccessedCollections(db)).not.toContain("characters");
  });

  it("bases party influence success on slate-style acceptance stats instead of extra funds", () => {
    const npp = {
      _id: new ObjectId(),
      name: "Latoya O'Connor",
      party: "1",
      homeState: "AK",
      retiredAt: null,
      favorability: 46,
      politicalInfluence: 10,
      personality: { loyalty: 64, ambition: 70, stubbornness: 52 },
    } as NPP;

    const withoutFunds = calculatePartyInfluenceChance(npp, "1", 50, 0);
    const withFunds = calculatePartyInfluenceChance(npp, "1", 50, 150000);

    expect(withoutFunds.fundBonus).toBe(0);
    expect(withFunds.fundBonus).toBe(0);
    expect(withFunds.finalChance).toBe(withoutFunds.finalChance);
    expect(withoutFunds.finalChance).toBe(63);
  });
});

describe("getStatePartyInfluenceOptions", () => {
  let db: MockDb;

  beforeEach(async () => {
    db = createMockDb();
    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
    db.collection("npps");
    db.collection("electionCandidates");
    db.collection("elections");
  });

  it("returns only same-state same-party NPPs and flags officeholders/candidates", async () => {
    const stateParty = {
      _id: "AK_1",
      stateId: "AK",
      partyId: "1",
      organization: 55,
      politicalStrength: 12,
      treasury: 250000,
    } as StatePartyOrg;
    const party = {
      _id: new ObjectId(),
      sequentialId: 1,
      countryId: "US",
      name: "Democratic Party",
      treasury: 500000,
      politicalStrength: 20,
    } as PoliticalParty;
    const officeholderId = new ObjectId();
    const candidateId = new ObjectId();
    const electionId = new ObjectId();

    db.collectionMocks.npps.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([
        {
          _id: officeholderId,
          name: "Office Holder",
          party: "1",
          homeState: "AK",
          currentOffice: { type: "senator", state: "AK", seatsHeld: 1 },
          retiredAt: null,
          favorability: 52,
          politicalInfluence: 14,
          personality: { loyalty: 66, ambition: 48, stubbornness: 31 },
        },
        {
          _id: candidateId,
          name: "Candidate NPP",
          party: "1",
          homeState: "AK",
          currentOffice: null,
          retiredAt: null,
          favorability: 45,
          politicalInfluence: 11,
          personality: { loyalty: 58, ambition: 60, stubbornness: 42 },
        },
      ]),
      sort: vi.fn().mockReturnThis(),
    });
    db.collectionMocks.electionCandidates.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([
        {
          _id: new ObjectId(),
          electionId,
          nppId: candidateId,
          isNPP: true,
          status: "active",
        },
      ]),
    });
    db.collectionMocks.elections.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([
        {
          _id: electionId,
          state: "AK",
          electionType: "senate",
          senateClass: 2,
        },
      ]),
    });

    const options = await getStatePartyInfluenceOptions(stateParty, party, true);

    expect(db.collectionMocks.npps.find).toHaveBeenCalledWith({
      homeState: "AK",
      party: "1",
      retiredAt: null,
    });
    expect(options.nppsInState).toHaveLength(2);
    expect(options.nppsInState.find((npp) => npp.name === "Candidate NPP")).toEqual(
      expect.objectContaining({
        name: "Candidate NPP",
        activeCandidacyLabel: "Senate (Class 2)",
      })
    );
    expect(options.nppsInState.find((npp) => npp.name === "Office Holder")).toEqual(
      expect.objectContaining({
        name: "Office Holder",
        currentOfficeLabel: "senator (AK)",
      })
    );
  });

  it("names the race with the country's election-type label and flags an out-of-state run", async () => {
    const stateParty = {
      _id: "AK_1",
      stateId: "AK",
      partyId: "1",
      organization: 55,
      politicalStrength: 12,
      treasury: 250000,
    } as StatePartyOrg;
    const party = {
      _id: new ObjectId(),
      sequentialId: 1,
      countryId: "NG",
      name: "Peoples Party",
      treasury: 500000,
      politicalStrength: 20,
    } as PoliticalParty;
    const candidateId = new ObjectId();
    const electionId = new ObjectId();

    db.collectionMocks.npps.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([
        {
          _id: candidateId,
          sequentialId: 77,
          name: "Travelling Candidate",
          party: "1",
          homeState: "AK",
          currentOffice: null,
          retiredAt: null,
          favorability: 45,
          politicalInfluence: 11,
          personality: { loyalty: 58, ambition: 60, stubbornness: 42 },
        },
      ]),
      sort: vi.fn().mockReturnThis(),
    });
    db.collectionMocks.electionCandidates.find.mockReturnValue({
      toArray: vi
        .fn()
        .mockResolvedValue([
          { _id: new ObjectId(), electionId, nppId: candidateId, isNPP: true, status: "active" },
        ]),
    });
    db.collectionMocks.elections.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([{ _id: electionId, state: "NV", electionType: "house" }]),
    });

    const options = await getStatePartyInfluenceOptions(stateParty, party, true);

    // NG renames "house"; the race sits outside the NPP's home state, so the
    // label leads with the state the seat is actually in.
    expect(options.nppsInState[0]).toEqual(
      expect.objectContaining({
        sequentialId: 77,
        activeCandidacyLabel: "NV House of Representatives",
      })
    );
  });

  it("does not prefix a nationwide race with the country id", async () => {
    const stateParty = {
      _id: "AK_1",
      stateId: "AK",
      partyId: "1",
      organization: 55,
      politicalStrength: 12,
      treasury: 250000,
    } as StatePartyOrg;
    const party = {
      _id: new ObjectId(),
      sequentialId: 1,
      countryId: "US",
      name: "Democratic Party",
      treasury: 500000,
      politicalStrength: 20,
    } as PoliticalParty;
    const candidateId = new ObjectId();
    const electionId = new ObjectId();

    db.collectionMocks.npps.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([
        {
          _id: candidateId,
          name: "White House Hopeful",
          party: "1",
          homeState: "AK",
          currentOffice: null,
          retiredAt: null,
          favorability: 45,
          politicalInfluence: 11,
          personality: { loyalty: 58, ambition: 60, stubbornness: 42 },
        },
      ]),
      sort: vi.fn().mockReturnThis(),
    });
    db.collectionMocks.electionCandidates.find.mockReturnValue({
      toArray: vi
        .fn()
        .mockResolvedValue([
          { _id: new ObjectId(), electionId, nppId: candidateId, isNPP: true, status: "active" },
        ]),
    });
    // Nationwide races store the country id in `state` (verified against live
    // data: US president -> state "US", NG president -> state "NG"), so a naive
    // "state differs from homeState" test would render "US President".
    db.collectionMocks.elections.find.mockReturnValue({
      toArray: vi
        .fn()
        .mockResolvedValue([{ _id: electionId, state: "US", electionType: "president" }]),
    });

    const options = await getStatePartyInfluenceOptions(stateParty, party, true);

    expect(options.nppsInState[0].activeCandidacyLabel).toBe("President");
  });
});

describe("executeNationalPartyInfluence", () => {
  let db: MockDb;
  let actorCharacterId: ObjectId;
  let userId: ObjectId;
  let party: PoliticalParty;
  let npp: NPP;

  beforeEach(async () => {
    db = createMockDb();
    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
    db.collection("politicalParties");
    db.collection("npps");
    db.collection("characters");
    db.collection("users");
    db.collection("gameState");
    db.collection("statePartyOrg");
    db.collection("nppInfluenceAttempts");

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
      favorability: 46,
      politicalInfluence: 10,
      currentOffice: null,
      retiredAt: null,
      personality: { loyalty: 64, ambition: 70, stubbornness: 52 },
      policies: { economic: 0, social: 0 },
      generatedAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    } as NPP;

    db.collectionMocks.politicalParties.findOne.mockResolvedValue(party);
    db.collectionMocks.npps.findOne.mockResolvedValue(npp);
    db.collectionMocks.characters.findOne.mockResolvedValue({
      _id: actorCharacterId,
      userId,
    });
    db.collectionMocks.users.findOne.mockResolvedValue({
      _id: userId,
      isAdmin: false,
    });
    db.collectionMocks.gameState.findOne.mockResolvedValue({
      _id: "current",
      currentTurn: 12,
    });
    db.collectionMocks.statePartyOrg.findOne.mockResolvedValue(null);
  });

  it("always succeeds a strengthen party loyalty attempt regardless of the roll, debiting 1 AP + $25k", async () => {
    const randomSpy = vi.spyOn(Math, "random").mockReturnValue(0.8);

    const result = await executeNationalPartyInfluence({
      partyId: "1",
      partyObjectId: party._id,
      countryId: "US",
      nppId: npp._id,
      influenceType: "boost_loyalty",
      fundAmount: 0,
      actorCharacterId,
      context: {},
    });

    expect(result.success).toBe(true);
    expect(result.outcome).toBe("success");
    expect(db.collectionMocks.politicalParties.updateOne).toHaveBeenCalledWith(
      expect.objectContaining({
        _id: party._id,
        nppActionPoints: { $gte: 1 },
        treasury: { $gte: 12500 },
      }),
      expect.objectContaining({ $inc: { nppActionPoints: -1, treasury: -12500 } })
    );
    randomSpy.mockRestore();
  });

  it("fails a national management action when AP is exhausted", async () => {
    db.collectionMocks.politicalParties.updateOne.mockResolvedValue({
      matchedCount: 0,
      modifiedCount: 0,
    });

    const result = await executeNationalPartyInfluence({
      partyId: "1",
      partyObjectId: party._id,
      countryId: "US",
      nppId: npp._id,
      influenceType: "boost_favorability",
      fundAmount: 0,
      actorCharacterId,
      context: {},
    });

    expect(result.success).toBe(false);
    expect(result.error ?? "").toMatch(/Insufficient/);
  });

  it("can succeed an improve cooperation attempt when the hidden willingness roll hits", async () => {
    const randomSpy = vi.spyOn(Math, "random").mockReturnValue(0);

    const result = await executeNationalPartyInfluence({
      partyId: "1",
      partyObjectId: party._id,
      countryId: "US",
      nppId: npp._id,
      influenceType: "reduce_stubbornness",
      fundAmount: 0,
      actorCharacterId,
      context: {},
    });

    expect(result.success).toBe(true);
    expect(result.outcome).toBe("success");
    expect(db.collectionMocks.npps.updateOne).toHaveBeenCalledWith(
      { _id: npp._id },
      expect.objectContaining({
        $set: expect.objectContaining({
          "personality.stubbornness": 51,
        }),
      })
    );
    randomSpy.mockRestore();
  });
});

describe("executeStatePartyInfluence", () => {
  let db: MockDb;
  let actorCharacterId: ObjectId;
  let userId: ObjectId;
  let party: PoliticalParty;
  let npp: NPP;
  let stateParty: StatePartyOrg;

  beforeEach(async () => {
    db = createMockDb();
    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
    db.collection("politicalParties");
    db.collection("npps");
    db.collection("characters");
    db.collection("users");
    db.collection("gameState");
    db.collection("statePartyOrg");
    db.collection("nppInfluenceAttempts");

    actorCharacterId = new ObjectId();
    userId = new ObjectId();
    party = {
      _id: new ObjectId(),
      sequentialId: 1,
      countryId: "US",
      name: "Democratic Party",
      politicalStrength: 20,
      treasury: 500000,
    } as PoliticalParty;
    stateParty = {
      _id: "AK_1",
      stateId: "AK",
      partyId: "1",
      chairId: actorCharacterId,
      viceChairId: null,
      politicalStrength: 20,
      treasury: 250000,
      organization: 50,
    } as StatePartyOrg;
    npp = {
      _id: new ObjectId(),
      name: "Latoya O'Connor",
      countryId: "US",
      homeState: "AK",
      party: "1",
      favorability: 46,
      politicalInfluence: 10,
      currentOffice: null,
      retiredAt: null,
      personality: { loyalty: 64, ambition: 70, stubbornness: 52 },
      policies: { economic: 0, social: 0 },
      generatedAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    } as NPP;

    db.collectionMocks.politicalParties.findOne.mockResolvedValue(party);
    db.collectionMocks.statePartyOrg.findOne.mockResolvedValue(stateParty);
    db.collectionMocks.npps.findOne.mockResolvedValue(npp);
    db.collectionMocks.characters.findOne.mockResolvedValue({
      _id: actorCharacterId,
      userId,
    });
    db.collectionMocks.users.findOne.mockResolvedValue({
      _id: userId,
      isAdmin: false,
    });
    db.collectionMocks.gameState.findOne.mockResolvedValue({
      _id: "current",
      currentTurn: 12,
    });
  });

  it("applies the hidden home-state bonus to loyalty/cooperation rolls", async () => {
    const randomSpy = vi.spyOn(Math, "random").mockReturnValue(0.64);

    const result = await executeStatePartyInfluence({
      partyId: "1",
      partyObjectId: party._id,
      countryId: "US",
      stateId: "AK",
      nppId: npp._id,
      influenceType: "boost_loyalty",
      fundAmount: 0,
      actorCharacterId,
      context: {},
    });

    expect(result.success).toBe(true);
    expect(result.outcome).toBe("success");
    expect(result.calculation.finalChance).toBe(66);
    randomSpy.mockRestore();
  });

  it("always succeeds a state management action regardless of the willingness roll", async () => {
    const randomSpy = vi.spyOn(Math, "random").mockReturnValue(0.99);

    const result = await executeStatePartyInfluence({
      partyId: "1",
      partyObjectId: party._id,
      countryId: "US",
      stateId: "AK",
      nppId: npp._id,
      influenceType: "boost_loyalty",
      fundAmount: 0,
      actorCharacterId,
      context: {},
    });

    expect(result.success).toBe(true);
    expect(result.outcome).toBe("success");
    randomSpy.mockRestore();
  });

  it("debits 1 AP + the per-action treasury cost for a state management action", async () => {
    const result = await executeStatePartyInfluence({
      partyId: "1",
      partyObjectId: party._id,
      countryId: "US",
      stateId: "AK",
      nppId: npp._id,
      influenceType: "boost_favorability",
      fundAmount: 0,
      actorCharacterId,
      context: {},
    });

    expect(result.success).toBe(true);
    expect(db.collectionMocks.statePartyOrg.updateOne).toHaveBeenCalledWith(
      expect.objectContaining({
        _id: "AK_1",
        nppActionPoints: { $gte: 1 },
        treasury: { $gte: 5000 },
      }),
      expect.objectContaining({ $inc: { nppActionPoints: -1, treasury: -5000 } })
    );
  });

  it("fails a state management action when AP is exhausted", async () => {
    db.collectionMocks.statePartyOrg.updateOne.mockResolvedValue({
      matchedCount: 0,
      modifiedCount: 0,
    });

    const result = await executeStatePartyInfluence({
      partyId: "1",
      partyObjectId: party._id,
      countryId: "US",
      stateId: "AK",
      nppId: npp._id,
      influenceType: "boost_favorability",
      fundAmount: 0,
      actorCharacterId,
      context: {},
    });

    expect(result.success).toBe(false);
    expect(result.error ?? "").toMatch(/Insufficient/);
  });
});
