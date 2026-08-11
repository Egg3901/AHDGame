import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import type { PoliticalParty } from "@/lib/db/types";
import { getPartyDetail } from "./partyDetail";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/turn/currentTurn", () => ({ getCurrentTurn: vi.fn() }));

describe("getPartyDetail", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("includes NPP home states when building the revenue estimate", async () => {
    const db: MockDb = createMockDb();
    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);

    const party = {
      _id: new ObjectId(),
      sequentialId: 2,
      countryId: "US",
      name: "Republican Party",
      abbreviation: "REP",
      color: "#ff0000",
      economicPosition: 4,
      socialPosition: 5,
      chairId: null,
      viceChairId: null,
      treasurerId: null,
      committeeIds: [],
      treasury: 1_000_000,
      nationalTaxRate: 33,
      politicalStrength: 0,
      isDefault: true,
      createdAt: new Date(),
      logoUrl: null,
    } as unknown as PoliticalParty;

    db.collection("characters");
    db.collection("users");
    db.collection("npps");
    db.collection("states");
    db.collection("partyBudget");
    db.collection("gameConfig");

    db.collectionMocks["characters"]!.find.mockReturnValue({
      sort: () => ({
        toArray: async () => [
          {
            _id: new ObjectId(),
            sequentialId: 1,
            name: "Player One",
            userId: new ObjectId(),
            homeState: "PA",
            donorBaseLevel: 0,
            currentOffice: null,
            partyInfluence: 0,
            policies: { economic: 4, social: 5 },
            countryId: "US",
          },
        ],
      }),
    });

    const memberUserId = new ObjectId();
    db.collectionMocks["characters"]!.find.mockReturnValueOnce({
      sort: () => ({
        toArray: async () => [
          {
            _id: new ObjectId(),
            sequentialId: 1,
            name: "Player One",
            userId: memberUserId,
            homeState: "PA",
            donorBaseLevel: 0,
            currentOffice: null,
            partyInfluence: 0,
            policies: { economic: 4, social: 5 },
            countryId: "US",
          },
        ],
      }),
    });
    db.collectionMocks["users"]!.find.mockReturnValue({
      project: () => ({
        toArray: async () => [{ _id: memberUserId, isBanned: false }],
      }),
    });

    db.collectionMocks["npps"]!.find.mockReturnValue({
      sort: () => ({
        toArray: async () => [
          {
            _id: new ObjectId(),
            sequentialId: 100,
            name: "NPP One",
            homeState: "TX",
            currentOffice: null,
            party: "2",
            countryId: "US",
            retiredAt: null,
          },
        ],
      }),
    });

    db.collectionMocks["states"]!.find.mockReturnValue({
      toArray: async () => [
        { _id: "PA", population: 100_000 },
        { _id: "TX", population: 100_000 },
      ],
    });

    db.collectionMocks["partyBudget"]!.findOne.mockResolvedValue({
      _id: new ObjectId(),
      partyId: "2",
      countryId: "US",
      scope: "national",
      gotvBudgetPercent: 25,
      suppressionBudgetPercent: 0,
      transferReserveAmount: 0,
      memberSupportReserveAmount: 0,
      nppRecruitmentReserveAmount: 0,
      treasuryPreset: "custom",
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    // NPP economy enabled so NPP income counts (this case asserts the NPP path).
    db.collectionMocks["gameConfig"]!.findOne.mockResolvedValue({ nppEconomyEnabled: true });

    const detail = await getPartyDetail(db as unknown as Db, party);

    // Player (PA, pop 100k, GDP absent → scalar 1.0, matching the turn
    // processor's raw state.gdp): small-tier $5,000, tax 33% = 1,650.
    // NPP (TX, pop 100k, funds 0): local-only log curve — logScale ~1,056 x 50%
    // = 528 x diminishing(0)=1.0 = 528 gross; tax 33% = 174. (No FX: funds are
    // local in all countries.) Total = 1,650 + 174 = 1,824; GOTV at 25% = 456.
    expect(detail.expectedHourlyIncome).toBe(1824);
    expect(detail.gotvEstimatedSpend).toBe(456);
  });

  it("excludes NPP income when the NPP economy is disabled (no phantom revenue)", async () => {
    const db: MockDb = createMockDb();
    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);

    const party = {
      _id: new ObjectId(),
      sequentialId: 2,
      countryId: "US",
      name: "Republican Party",
      abbreviation: "REP",
      color: "#ff0000",
      economicPosition: 4,
      socialPosition: 5,
      chairId: null,
      viceChairId: null,
      treasurerId: null,
      committeeIds: [],
      treasury: 1_000_000,
      nationalTaxRate: 33,
      politicalStrength: 0,
      isDefault: true,
      createdAt: new Date(),
      logoUrl: null,
    } as unknown as PoliticalParty;

    db.collection("characters");
    db.collection("users");
    db.collection("npps");
    db.collection("states");
    db.collection("partyBudget");
    db.collection("gameConfig");

    const memberUserId = new ObjectId();
    db.collectionMocks["characters"]!.find.mockReturnValue({
      sort: () => ({
        toArray: async () => [
          {
            _id: new ObjectId(),
            sequentialId: 1,
            name: "Player One",
            userId: memberUserId,
            homeState: "PA",
            donorBaseLevel: 0,
            currentOffice: null,
            partyInfluence: 0,
            policies: { economic: 4, social: 5 },
            countryId: "US",
          },
        ],
      }),
    });
    db.collectionMocks["users"]!.find.mockReturnValue({
      project: () => ({ toArray: async () => [{ _id: memberUserId, isBanned: false }] }),
    });
    db.collectionMocks["npps"]!.find.mockReturnValue({
      sort: () => ({
        toArray: async () => [
          {
            _id: new ObjectId(),
            sequentialId: 100,
            name: "NPP One",
            homeState: "TX",
            currentOffice: null,
            party: "2",
            countryId: "US",
            retiredAt: null,
          },
        ],
      }),
    });
    db.collectionMocks["states"]!.find.mockReturnValue({
      toArray: async () => [
        { _id: "PA", population: 100_000 },
        { _id: "TX", population: 100_000 },
      ],
    });
    db.collectionMocks["partyBudget"]!.findOne.mockResolvedValue({
      _id: new ObjectId(),
      partyId: "2",
      countryId: "US",
      scope: "national",
      gotvBudgetPercent: 25,
      suppressionBudgetPercent: 0,
      treasuryPreset: "custom",
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    // NPP economy DISABLED → NPP contributes $0, matching the turn processor.
    db.collectionMocks["gameConfig"]!.findOne.mockResolvedValue({ nppEconomyEnabled: false });

    const detail = await getPartyDetail(db as unknown as Db, party);

    // Player only: $5,000 x tax 33% = 1,650. NPP excluded (economy off).
    // GOTV at 25% of 1,650 = 412.
    expect(detail.expectedHourlyIncome).toBe(1650);
    expect(detail.gotvEstimatedSpend).toBe(412);
  });

  it("hides players inactive for more than 96 turns from the membership roster", async () => {
    const db: MockDb = createMockDb();
    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);

    const party = {
      _id: new ObjectId(),
      sequentialId: 2,
      countryId: "US",
      name: "Republican Party",
      abbreviation: "REP",
      color: "#ff0000",
      economicPosition: 4,
      socialPosition: 5,
      chairId: null,
      viceChairId: null,
      treasurerId: null,
      committeeIds: [],
      treasury: 0,
      nationalTaxRate: 0,
      politicalStrength: 0,
      isDefault: true,
      createdAt: new Date(),
      logoUrl: null,
    } as unknown as PoliticalParty;

    db.collection("characters");
    db.collection("users");
    db.collection("npps");
    db.collection("states");
    db.collection("partyBudget");
    db.collection("gameConfig");

    const TURN_MS = 60 * 60 * 1000;
    const inactiveUserId = new ObjectId();
    db.collectionMocks["characters"]!.find.mockReturnValue({
      sort: () => ({
        toArray: async () => [
          {
            _id: new ObjectId(),
            sequentialId: 1,
            name: "Ghost Player",
            userId: inactiveUserId,
            homeState: "PA",
            donorBaseLevel: 0,
            currentOffice: null,
            partyInfluence: 0,
            policies: { economic: 4, social: 5 },
            countryId: "US",
          },
        ],
      }),
    });
    // Not banned, but last active 200 turns ago → inactive.
    db.collectionMocks["users"]!.find.mockReturnValue({
      project: () => ({
        toArray: async () => [
          {
            _id: inactiveUserId,
            isBanned: false,
            lastActivity: new Date(Date.now() - 200 * TURN_MS),
          },
        ],
      }),
    });
    db.collectionMocks["npps"]!.find.mockReturnValue({
      sort: () => ({
        toArray: async () => [
          {
            _id: new ObjectId(),
            sequentialId: 100,
            name: "NPP One",
            homeState: "TX",
            currentOffice: null,
            party: "2",
            countryId: "US",
            retiredAt: null,
          },
        ],
      }),
    });
    db.collectionMocks["states"]!.find.mockReturnValue({
      toArray: async () => [
        { _id: "PA", population: 100_000 },
        { _id: "TX", population: 100_000 },
      ],
    });
    db.collectionMocks["partyBudget"]!.findOne.mockResolvedValue(null);
    db.collectionMocks["gameConfig"]!.findOne.mockResolvedValue(null);

    const detail = await getPartyDetail(db as unknown as Db, party);
    const memberNames = detail.members.map((m) => m.name);
    expect(memberNames).not.toContain("Ghost Player");
    expect(memberNames).toContain("NPP One");
  });

  it("passes lastPurgeAtTurn and currentTurn through to PartyData", async () => {
    const db: MockDb = createMockDb();
    const { getDb } = await import("@/lib/mongodb");
    const { getCurrentTurn } = await import("@/lib/turn/currentTurn");
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
    vi.mocked(getCurrentTurn).mockResolvedValue(42);

    const party = {
      _id: new ObjectId(),
      sequentialId: 3,
      countryId: "US",
      name: "Test Party",
      abbreviation: "TST",
      color: "#aabbcc",
      economicPosition: 0,
      socialPosition: 0,
      chairId: null,
      viceChairId: null,
      treasurerId: null,
      committeeIds: [],
      treasury: 0,
      nationalTaxRate: 0,
      politicalStrength: 0,
      isDefault: false,
      lastPurgeAtTurn: 38,
      createdAt: new Date(),
    } as unknown as PoliticalParty;

    db.collection("characters");
    db.collection("users");
    db.collection("npps");
    db.collection("states");
    db.collection("partyBudget");
    db.collection("gameConfig");

    db.collectionMocks["characters"]!.find.mockReturnValue({
      sort: () => ({ toArray: async () => [] }),
    });
    db.collectionMocks["users"]!.find.mockReturnValue({
      project: () => ({ toArray: async () => [] }),
    });
    db.collectionMocks["npps"]!.find.mockReturnValue({
      sort: () => ({ toArray: async () => [] }),
    });
    db.collectionMocks["states"]!.find.mockReturnValue({ toArray: async () => [] });
    db.collectionMocks["partyBudget"]!.findOne.mockResolvedValue(null);
    db.collectionMocks["gameConfig"]!.findOne.mockResolvedValue(null);

    const result = await getPartyDetail(db as unknown as Db, party);

    expect(result.lastPurgeAtTurn).toBe(38);
    expect(result.currentTurn).toBe(42);
  });

  it("resolves effectivePsCap to the Minor-tier cap (not the full national cap)", async () => {
    const db: MockDb = createMockDb();
    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);

    // Minor party with 2 earned regions → cap = 100 + 10×2 = 120 (NOT 280).
    const minor = {
      _id: new ObjectId(),
      sequentialId: 7,
      countryId: "US",
      name: "Democratic Socialists",
      abbreviation: "DSA",
      color: "#aa1133",
      economicPosition: 0,
      socialPosition: 0,
      chairId: null,
      viceChairId: null,
      treasurerId: null,
      committeeIds: [],
      treasury: 0,
      nationalTaxRate: 0,
      politicalStrength: 130,
      isDefault: false,
      tier: "minor",
      psCapEarnedRegions: ["CA", "TX"],
      createdAt: new Date(),
    } as unknown as PoliticalParty;

    db.collection("characters");
    db.collection("users");
    db.collection("npps");
    db.collection("states");
    db.collection("partyBudget");
    db.collection("gameConfig");
    db.collectionMocks["characters"]!.find.mockReturnValue({
      sort: () => ({ toArray: async () => [] }),
    });
    db.collectionMocks["users"]!.find.mockReturnValue({
      project: () => ({ toArray: async () => [] }),
    });
    db.collectionMocks["npps"]!.find.mockReturnValue({
      sort: () => ({ toArray: async () => [] }),
    });
    db.collectionMocks["states"]!.find.mockReturnValue({ toArray: async () => [] });
    db.collectionMocks["partyBudget"]!.findOne.mockResolvedValue(null);
    db.collectionMocks["gameConfig"]!.findOne.mockResolvedValue(null);

    const result = await getPartyDetail(db as unknown as Db, minor);

    expect(result.tier).toBe("minor");
    expect(result.effectivePsCap).toBe(120);
  });
});
