import { describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import type { Character, CentralBank, NPP, PoliticalParty } from "@/lib/db/types";
import {
  alignInflationBreakdownToDisplayRate,
  buildCentralBankChairData,
  loadCountryCentralBankDetail,
} from "./countryCentralBankDetail";

const world = vi.hoisted(() => ({ currentTurn: 120, currentYear: 2027, preset: "2027" }));

vi.mock("@/lib/gameState", () => ({ getGameState: async () => world }));

describe("alignInflationBreakdownToDisplayRate", () => {
  it("keeps the tooltip total aligned with the displayed inflation rate", () => {
    const result = alignInflationBreakdownToDisplayRate({
      displayRate: -2,
      computedRate: 1.46,
      breakdown: {
        base: 2,
        unemployment: -0.47,
        gdp: 0.17,
        monetary: -1.23,
        fiscal: 0.82,
        tariff: -0.03,
        wage: 0.07,
        commodity: 1.1,
        forex: -0.11,
        savings: 0.01,
        housing: 0,
        policy: 0,
        inertia: -0.87,
      },
    });

    const total =
      result.inflationBreakdown.base +
      result.inflationBreakdown.unemployment +
      result.inflationBreakdown.gdp +
      result.inflationBreakdown.monetary +
      result.inflationBreakdown.fiscal +
      result.inflationBreakdown.tariff +
      result.inflationBreakdown.wage +
      result.inflationBreakdown.commodity +
      result.inflationBreakdown.forex +
      result.inflationBreakdown.savings +
      result.inflationBreakdown.housing +
      result.inflationBreakdown.policy +
      result.inflationBreakdown.inertia;

    expect(result.currentInflation).toBe(-2);
    expect(result.inflationBreakdownTotal).toBe(-2);
    expect(total).toBeCloseTo(-2, 10);
  });

  it("preserves a non-zero policy term so it reaches the UI breakdown", () => {
    const result = alignInflationBreakdownToDisplayRate({
      displayRate: 3,
      computedRate: 3,
      breakdown: {
        base: 2,
        unemployment: 0,
        gdp: 0,
        monetary: 0,
        fiscal: 0,
        tariff: 0,
        wage: 0,
        commodity: 0,
        forex: 0,
        savings: 0,
        housing: 0,
        policy: 0.4,
        inertia: 0.6,
      },
    });
    expect(result.inflationBreakdown.policy).toBeCloseTo(0.4, 10);
  });

  it("falls back to the computed rate when no stored display rate exists", () => {
    const result = alignInflationBreakdownToDisplayRate({
      displayRate: undefined,
      computedRate: 1.46,
      breakdown: {
        base: 2,
        unemployment: -0.47,
        gdp: 0.17,
        monetary: -1.23,
        fiscal: 0.82,
        tariff: -0.03,
        wage: 0.07,
        commodity: 1.1,
        forex: -0.11,
        savings: 0.01,
        housing: 0,
        policy: 0,
        inertia: -0.87,
      },
    });

    expect(result.currentInflation).toBe(1.46);
    expect(result.inflationBreakdownTotal).toBe(1.46);
    expect(result.inflationBreakdown.inertia).toBe(-0.87);
  });
});

function createMockDb(collections: {
  npps?: NPP[];
  characters?: Character[];
  politicalParties?: PoliticalParty[];
}) {
  const lookup = (docs: { _id: ObjectId }[] | undefined) =>
    vi.fn(async (filter: Record<string, unknown>) => {
      if (!docs) return null;
      return (
        docs.find((doc) => {
          return Object.entries(filter).every(([key, value]) => {
            const docValue = (doc as Record<string, unknown>)[key];
            if (docValue instanceof ObjectId && value instanceof ObjectId) {
              return docValue.equals(value);
            }

            // Loose compare deliberately emulates Mongo's cross-type equality in this mock.
            // eslint-disable-next-line eqeqeq
            return docValue == value;
          });
        }) ?? null
      );
    });

  return {
    collection: vi.fn((name: string) => {
      if (name === "npps") return { findOne: lookup(collections.npps) };
      if (name === "characters") return { findOne: lookup(collections.characters) };
      if (name === "politicalParties") return { findOne: lookup(collections.politicalParties) };
      return { findOne: vi.fn().mockResolvedValue(null) };
    }),
  } as unknown as import("mongodb").Db;
}

describe("buildCentralBankChairData", () => {
  it("returns character mode for a legacy/character chair and omits NPP fields", async () => {
    const chairCharId = new ObjectId();
    const partyId = 42;
    const chairCharacter: Character = {
      _id: chairCharId,
      name: "Alan Greenspan",
      sequentialId: 101,
      avatarUrl: "/avatar.png",
      party: String(partyId),
      countryId: "US",
    } as unknown as Character;
    const party: PoliticalParty = {
      _id: new ObjectId(),
      sequentialId: partyId,
      name: "Whig Party",
      countryId: "US",
    } as unknown as PoliticalParty;

    const db = createMockDb({ characters: [chairCharacter], politicalParties: [party] });
    const bank = {
      _id: "US",
      countryId: "US",
      chairCharacterId: chairCharId,
      chairMode: "character",
      chairNppId: null,
    } as unknown as CentralBank;

    const result = await buildCentralBankChairData(db, bank);

    expect(result.chairMode).toBe("character");
    expect(result.chairNppId).toBeNull();
    expect(result.chairData).not.toBeNull();
    expect(result.chairData?.characterId).toBe(chairCharId.toHexString());
    expect(result.chairData?.name).toBe("Alan Greenspan");
    expect(result.chairData?.partyName).toBe("Whig Party");
  });

  it("defaults to character mode when chairMode is absent (backward-compatible)", async () => {
    const chairCharId = new ObjectId();
    const chairCharacter = {
      _id: chairCharId,
      name: "Janet Yellen",
      sequentialId: 202,
      countryId: "US",
    } as unknown as Character;

    const db = createMockDb({ characters: [chairCharacter] });
    // No chairMode / chairNppId fields at all — legacy bank doc.
    const bank = {
      _id: "US",
      countryId: "US",
      chairCharacterId: chairCharId,
    } as unknown as CentralBank;

    const result = await buildCentralBankChairData(db, bank);

    expect(result.chairMode).toBe("character");
    expect(result.chairNppId).toBeNull();
    expect(result.chairData?.name).toBe("Janet Yellen");
  });

  it("returns npp mode and populates the chair name from the technocrat NPP lookup", async () => {
    const nppId = new ObjectId();
    const technocrat: NPP = {
      _id: nppId,
      name: "Dr. Technocrat",
      countryId: "US",
      homeState: "",
      politicalInfluence: 0,
      favorability: 50,
      policies: { economic: 0, social: 0, domainPositions: {} },
      party: "",
      currentOffice: null,
      personality: { loyalty: 50, ambition: 50, stubbornness: 50 },
      generatedAt: new Date(),
      retiredAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      isTechnocrat: true,
      technocratRole: "centralBankChair",
    } as unknown as NPP;

    const db = createMockDb({ npps: [technocrat] });
    const bank = {
      _id: "US",
      countryId: "US",
      chairCharacterId: null,
      chairMode: "npp",
      chairNppId: nppId,
    } as unknown as CentralBank;

    const result = await buildCentralBankChairData(db, bank);

    expect(result.chairMode).toBe("npp");
    expect(result.chairNppId).toBe(nppId.toHexString());
    expect(result.chairData).not.toBeNull();
    expect(result.chairData?.characterId).toBe(nppId.toHexString());
    expect(result.chairData?.name).toBe("Dr. Technocrat");
    // Technocrat chairs have no party.
    expect(result.chairData?.partyId).toBeUndefined();
    expect(result.chairData?.partyName).toBeUndefined();
  });

  it("returns empty chair (not a character) when npp mode is set but the NPP doc is missing (M1)", async () => {
    const chairCharId = new ObjectId();
    const chairCharacter = {
      _id: chairCharId,
      name: "Fallback Chair",
      sequentialId: 303,
      countryId: "US",
    } as unknown as Character;

    const db = createMockDb({ characters: [chairCharacter] });
    const bank = {
      _id: "US",
      countryId: "US",
      chairCharacterId: chairCharId,
      chairMode: "npp",
      chairNppId: new ObjectId(), // stale/missing NPP reference
    } as unknown as CentralBank;

    const result = await buildCentralBankChairData(db, bank);

    // chairMode still reflects the bank's configured mode.
    expect(result.chairMode).toBe("npp");
    expect(result.chairNppId).toBe(bank.chairNppId!.toString());
    // An npp chair must NEVER resolve to a character — a stale chairNppId
    // renders the empty-chair state, not a player name under the AI badge (M1).
    expect(result.chairData).toBeNull();
  });
});

describe("loadCountryCentralBankDetail money supply", () => {
  const snapshot = {
    _id: "USD:120",
    turn: 120,
    currencyCode: "USD",
    m1: 1_000,
    m2: 1_500,
    annualizedM2GrowthPct: null,
  };

  function createDetailDb(
    moneySupplyEnabled: boolean | undefined,
    hasSnapshot = true,
    fx?: Record<string, unknown>
  ): Db {
    const documents: Record<string, Record<string, unknown>> = {
      ...(fx ? { exchangeRates: { _id: "US", ...fx } } : {}),
      gameConfig: {
        _id: "default",
        lineOfCreditEnabled: true,
        ...(moneySupplyEnabled === undefined ? {} : { moneySupplyEnabled }),
      },
      ...(hasSnapshot ? { moneySupplySnapshots: snapshot } : {}),
    };
    return {
      collection: (name: string) => ({
        findOne: async (
          filter: Record<string, unknown>,
          options?: { projection?: Record<string, number> }
        ) => {
          const doc = documents[name];
          if (!doc || !Object.entries(filter).every(([key, value]) => doc[key] === value)) {
            return null;
          }
          // Honour inclusion projections so omitted feature flags cannot leak into the result.
          return options?.projection
            ? Object.fromEntries(
                Object.entries(doc).filter(
                  ([key]) => key === "_id" || options.projection?.[key] === 1
                )
              )
            : doc;
        },
        findOneAndUpdate: async (
          _filter: unknown,
          update: { $setOnInsert: Record<string, unknown> }
        ) => update.$setOnInsert,
        find: () => ({ toArray: async () => [] }),
        aggregate: () => ({ toArray: async () => [] }),
      }),
    } as unknown as Db;
  }

  it("shows effective peg before an hourly turn without disclosing reserve history", async () => {
    const result = await loadCountryCentralBankDetail({
      db: createDetailDb(true, true, {
        fxRegime: "peg",
        pegTarget: 0.5,
        rate: 1,
        baseRate: 1,
        interventionPolicy: { floor: 0.9, ceiling: 1.1, recentInterventions: [{ turn: 119 }] },
      }),
      countryId: "US",
      viewer: null,
    });
    if (!result.ok) throw new Error(result.error);
    expect(result.body.intervention).toMatchObject({
      fxRegime: "peg",
      policy: { floor: 0.5, ceiling: 0.5, recentInterventions: [] },
      forexRevenue: null,
      reserveBalance: null,
    });
  });
  it("returns the stored money supply for a public viewer when enabled", async () => {
    const result = await loadCountryCentralBankDetail({
      db: createDetailDb(true),
      countryId: "US",
      viewer: null,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error);
    expect(result.body.moneySupply).toMatchObject(snapshot);
    expect(result.body.lineOfCreditEnabled).toBe(true);
    expect(result.body.isChair).toBe(false);
    expect(result.body.isAdmin).toBe(false);
  });

  it.each([false, undefined])("keeps money supply hidden when enabled is %s", async (enabled) => {
    const result = await loadCountryCentralBankDetail({
      db: createDetailDb(enabled),
      countryId: "US",
      viewer: null,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error);
    expect(result.body.moneySupply).toBeNull();
  });

  it.each([0, 120])("handles a missing snapshot at world turn %s", async (currentTurn) => {
    world.currentTurn = currentTurn;
    const result = await loadCountryCentralBankDetail({
      db: createDetailDb(true, false),
      countryId: "US",
      viewer: null,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error);
    expect(result.body.moneySupply).toBeNull();
  });
});
