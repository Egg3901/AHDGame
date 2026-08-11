import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import {
  AFRICA_AMERICAS_1953_MACRO_ENTITY_IDS,
  ALL_1953_MACRO_ENTITY_IDS,
  ASIA_ME_1953_MACRO_ENTITY_IDS,
  AUSTRIA_ENTITY_ID,
  EUROPE_1953_MACRO_ENTITY_IDS,
  MACRO_FORBIDDEN_SEED_COLLECTIONS,
  MACRO_TICK_INTERVAL,
  PLANNED_EUROPE_1953_MACRO_ENTITY_IDS,
  PLANNED_MARKET_LEAKAGE,
  applyMacroContributionsToGlobal,
  computeMacroContribution,
  getAfricaAmericas1953MacroCountry,
  getAsiaMiddleEast1953MacroCountry,
  getAustria1953MacroCountry,
  getAuthored1953MacroCountry,
  getEurope1953MacroCountry,
  getMacroCountryDiagnostics,
  isMacroTickTurn,
  listAfricaAmericas1953MacroCountries,
  listAll1953MacroCountries,
  listAsiaMiddleEast1953MacroCountries,
  listEurope1953MacroCountries,
  macroTickBucket,
  processMacroCountryTurn,
  seedMacroCountries,
} from "./index";
import { COMMODITY_TYPES, type CommodityType } from "@/lib/constants/commodities";
import {
  getWorldEntityOrThrow,
  getWorldEntityPresetManifest,
} from "@/lib/world/worldEntityManifest";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));

/** Shared Austria-oracle invariants every Tier-2 country must pass. */
function expectOracleInvariants(
  country: ReturnType<typeof getAuthored1953MacroCountry>,
  entityId: string
) {
  expect(country.entityId).toBe(entityId);
  expect(country.presetId).toBe("1953-default");
  expect(country.population).toBeGreaterThan(0);
  expect(country.fiscalCapacity).toBeGreaterThan(0);
  expect(country.fiscalCapacity).toBeLessThanOrEqual(1);
  expect(country.stability).toBeGreaterThan(0);
  expect(country.stability).toBeLessThanOrEqual(1);
  expect(country.tradeExposure).toBeGreaterThan(0);
  expect(country.tradeExposure).toBeLessThanOrEqual(1);
  expect(country.economicSystem === "market" || country.economicSystem === "planned").toBe(true);
  expect(Object.keys(country.sectors).length).toBeGreaterThan(0);
  expect(Object.keys(country.resources).length).toBeGreaterThan(0);
  expect(country.contribution.computedOnTurn).toBe(1);
  expect(Object.keys(country.contribution.byCommodity).length).toBeGreaterThan(0);
  expect(country.lastMacroTickTurn).toBe(1);
  expect(country.dataQuality.provenance).toBe("authored-1953");
  expect(country.dataQuality.missingFields).toEqual([]);
  expect(country.dataQuality.fallbackFields).toEqual([]);
  expect(country.dataQuality.economicSystem).toBe(country.economicSystem);
}

describe("Austria Tier-2 sphere-macro economy", () => {
  describe("1953 seed shape", () => {
    it("seeds aggregate capacity, productivity, demand, resources, population, fiscal capacity, stability, and trade exposure", () => {
      const austria = getAustria1953MacroCountry(new Date("1953-01-20T00:00:00Z"));

      expectOracleInvariants(austria, AUSTRIA_ENTITY_ID);
      expect(austria.population).toBe(6_950_000);
      expect(austria.economicSystem).toBe("market");
      expect(austria.resources.iron).toBeGreaterThan(0);
      expect(austria.resources.timber).toBeGreaterThan(0);

      const manufacturing = austria.sectors.manufacturing;
      expect(manufacturing).toBeDefined();
      expect(manufacturing!.capacity).toBeGreaterThan(0);
      expect(manufacturing!.productivity).toBe(1);
      expect(manufacturing!.domesticDemand).toBeGreaterThan(0);
      expect(austria.contribution.bySector.manufacturing?.output).toBeGreaterThan(0);
    });
  });

  describe("six-turn cadence", () => {
    it("uses a fixed interval of six turns", () => {
      expect(MACRO_TICK_INTERVAL).toBe(6);
    });

    it("updates on exactly the scheduled turns for Austria and skips the rest", () => {
      const bucket = macroTickBucket(AUSTRIA_ENTITY_ID);
      const tickTurns: number[] = [];
      for (let turn = 1; turn <= 24; turn++) {
        if (isMacroTickTurn(turn, AUSTRIA_ENTITY_ID)) tickTurns.push(turn);
      }

      expect(tickTurns.length).toBe(4);
      for (const turn of tickTurns) {
        expect((turn - 1 - bucket) % MACRO_TICK_INTERVAL).toBe(0);
      }
      if (tickTurns.length >= 2) {
        const mid = tickTurns[0]! + 1;
        expect(isMacroTickTurn(mid, AUSTRIA_ENTITY_ID)).toBe(false);
      }
    });

    it("refreshes DB contribution only on tick turns", async () => {
      const db = createMockDb();
      db.collection("macroCountries");
      const austria = getAustria1953MacroCountry();
      const findCursor = {
        toArray: vi.fn().mockResolvedValue([austria]),
        sort: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        skip: vi.fn().mockReturnThis(),
        project: vi.fn().mockReturnThis(),
      };
      db.collectionMocks.macroCountries!.find.mockReturnValue(findCursor);
      db.collectionMocks.macroCountries!.updateOne.mockResolvedValue({
        acknowledged: true,
        matchedCount: 1,
        modifiedCount: 1,
        upsertedCount: 0,
        upsertedId: null,
      });

      const tickTurn =
        [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].find((t) =>
          isMacroTickTurn(t, AUSTRIA_ENTITY_ID)
        ) ?? 1;
      const nonTick =
        [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].find(
          (t) => !isMacroTickTurn(t, AUSTRIA_ENTITY_ID)
        ) ?? 2;

      const skipped = await processMacroCountryTurn(db as unknown as Db, nonTick);
      expect(skipped.countriesUpdated).toBe(0);
      expect(db.collectionMocks.macroCountries!.updateOne).not.toHaveBeenCalled();

      const updated = await processMacroCountryTurn(db as unknown as Db, tickTurn);
      expect(updated.countriesUpdated).toBe(1);
      expect(updated.updatedEntityIds).toEqual([AUSTRIA_ENTITY_ID]);
      expect(db.collectionMocks.macroCountries!.updateOne).toHaveBeenCalledTimes(1);
      const setDoc = db.collectionMocks.macroCountries!.updateOne.mock.calls[0]![1].$set;
      expect(setDoc.lastMacroTickTurn).toBe(tickTurn);
      expect(setDoc.contribution.computedOnTurn).toBe(tickTurn);
    });
  });

  describe("contribution persistence between updates", () => {
    it("keeps the same held contribution when the kernel does not tick", () => {
      const austria = getAustria1953MacroCountry();
      const first = austria.contribution;
      const second = computeMacroContribution(austria, first.computedOnTurn);

      expect(second.byCommodity).toEqual(first.byCommodity);
      expect(second.bySector).toEqual(first.bySector);
    });

    it("applies the held contribution to global market balances every turn", () => {
      const austria = getAustria1953MacroCountry();
      const global = new Map<CommodityType, { supply: number; demand: number }>();
      for (const c of COMMODITY_TYPES) global.set(c, { supply: 100, demand: 100 });

      applyMacroContributionsToGlobal(global, [austria.contribution]);

      let changed = 0;
      for (const [commodity, bal] of Object.entries(austria.contribution.byCommodity) as [
        CommodityType,
        { supply: number; demand: number },
      ][]) {
        const g = global.get(commodity)!;
        expect(g.supply).toBe(100 + bal.supply);
        expect(g.demand).toBe(100 + bal.demand);
        changed++;
      }
      expect(changed).toBeGreaterThan(0);
    });
  });

  describe("no firms/offices seeded invariant", () => {
    let db: MockDb;

    beforeEach(() => {
      db = createMockDb();
      db.collection("macroCountries");
      for (const name of MACRO_FORBIDDEN_SEED_COLLECTIONS) {
        db.collection(name);
      }
      db.collectionMocks.macroCountries!.updateOne.mockResolvedValue({
        acknowledged: true,
        matchedCount: 0,
        modifiedCount: 0,
        upsertedCount: 1,
        upsertedId: AUSTRIA_ENTITY_ID,
      });
    });

    it("seeds the full 1953 Tier-2 roster into macroCountries only", async () => {
      const seeded = await seedMacroCountries(db as unknown as Db, "1953-default");
      expect(seeded).toBe(ALL_1953_MACRO_ENTITY_IDS.length);
      expect(db.collectionMocks.macroCountries!.updateOne).toHaveBeenCalledTimes(
        ALL_1953_MACRO_ENTITY_IDS.length
      );

      const seededIds = db.collectionMocks.macroCountries!.updateOne.mock.calls.map(
        (call) => call[1].$set.entityId as string
      );
      expect(seededIds.sort()).toEqual([...ALL_1953_MACRO_ENTITY_IDS].sort());
    });

    it("never touches firm, corporate, NPP, or office collections", async () => {
      await seedMacroCountries(db as unknown as Db, "1953-default");

      for (const name of MACRO_FORBIDDEN_SEED_COLLECTIONS) {
        const mock = db.collectionMocks[name];
        if (!mock) continue;
        expect(mock.insertOne, name).not.toHaveBeenCalled();
        expect(mock.insertMany, name).not.toHaveBeenCalled();
        expect(mock.updateOne, name).not.toHaveBeenCalled();
        expect(mock.updateMany, name).not.toHaveBeenCalled();
        expect(mock.bulkWrite, name).not.toHaveBeenCalled();
      }
    });

    it("is a no-op for presets without sphere-macro entities", async () => {
      const seeded = await seedMacroCountries(db as unknown as Db, "2019-default");
      expect(seeded).toBe(0);
      expect(db.collectionMocks.macroCountries!.updateOne).not.toHaveBeenCalled();
    });
  });

  describe("admin diagnostics", () => {
    it("exposes last macro tick, sector contributions, and data-quality flags", async () => {
      const db = createMockDb();
      db.collection("macroCountries");
      const austria = getAustria1953MacroCountry();
      const findCursor = {
        toArray: vi.fn().mockResolvedValue([austria]),
        sort: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        skip: vi.fn().mockReturnThis(),
        project: vi.fn().mockReturnThis(),
      };
      db.collectionMocks.macroCountries!.find.mockReturnValue(findCursor);

      const diagnostics = await getMacroCountryDiagnostics(db as unknown as Db);
      expect(diagnostics).toHaveLength(1);
      expect(diagnostics[0]).toMatchObject({
        entityId: AUSTRIA_ENTITY_ID,
        economicSystem: "market",
        lastMacroTickTurn: 1,
        contributionComputedOnTurn: 1,
        dataQuality: {
          provenance: "authored-1953",
          missingFields: [],
          fallbackFields: [],
        },
      });
      expect(diagnostics[0]!.sectorContributions.manufacturing?.output).toBeGreaterThan(0);
      expect(Object.keys(diagnostics[0]!.commodityContributions).length).toBeGreaterThan(0);
    });
  });
});

describe("European 1953 Tier-2 roster (#3719)", () => {
  it("classifies every roster country as sphere-macro in the 1953 manifest", () => {
    // ES joined this list on 2026-07-28 (owner decision): 1953 Spain is
    // Franco's dictatorship — congresoDiputados and the Senado are both
    // era-gated off, so a full-autonomous classification modeled a
    // legislature that never held an election. Ireland is Tier 1 because its
    // authored sectors, parties, and autonomous offices are active in 1953.
    const expected = ["ES"] as const;
    expect([...EUROPE_1953_MACRO_ENTITY_IDS].sort()).toEqual([...expected].sort());
    // Re-promoted full-autonomous countries must not remain on the macro roster.
    // AT/FI/GR joined this list: each has a real authored multi-party seed
    // (at/atParties.ts, fi/fiParties.ts, gr/grParties.ts, 6 parties apiece),
    // so classifying them as abstract Tier-2 economies was a mis-tiering —
    // seedCountryGameStates skips entries without a countryId, so they never
    // got a countryGameStates row and their contested legislatures never held
    // an election for the life of a 1953-default world.
    for (const entityId of [
      "FR",
      "IT",
      "SE",
      "TR",
      "PL",
      "CS",
      "HU",
      "RO",
      "BG",
      "YU",
      "AT",
      "FI",
      "GR",
    ] as const) {
      expect(EUROPE_1953_MACRO_ENTITY_IDS).not.toContain(entityId);
      expect(getWorldEntityOrThrow("1953-default", entityId).simulationTier).toBe(
        "full-autonomous"
      );
    }

    for (const entityId of expected) {
      const entry = getWorldEntityOrThrow("1953-default", entityId);
      expect(entry.simulationTier).toBe("sphere-macro");
      expect(entry.legacyAccess).toBe("hidden");
    }
  });

  it("seeds every roster country as Tier 2 with authored 1953 inputs", () => {
    for (const entityId of EUROPE_1953_MACRO_ENTITY_IDS) {
      const country = getEurope1953MacroCountry(entityId);
      expectOracleInvariants(country, entityId);
    }
  });

  it("keeps Austria as the reference oracle among shared invariants", () => {
    const austria = getAustria1953MacroCountry();
    const roster = listEurope1953MacroCountries();
    // Austria left the seeded roster when it was promoted to full-autonomous,
    // but it remains the GDP-unit oracle the other specs are anchored to
    // (AT = 7_500 game units), so the seed must still resolve and hold the
    // shared invariants — it is simply no longer seeded as a macro country.
    expect(roster.some((c) => c.entityId === AUSTRIA_ENTITY_ID)).toBe(false);
    expectOracleInvariants(austria, AUSTRIA_ENTITY_ID);

    for (const country of roster) {
      expectOracleInvariants(country, country.entityId);
      // Contribution recomputation is deterministic for identical state.
      const recomputed = computeMacroContribution(country, 1);
      expect(recomputed.byCommodity).toEqual(country.contribution.byCommodity);
    }

    expect(austria.population).toBe(6_950_000);
    expect(austria.tradeExposure).toBe(0.35);
  });

  it("no longer seeds Eastern bloc as planned sphere-macro (promoted to Tier-1)", () => {
    expect(PLANNED_EUROPE_1953_MACRO_ENTITY_IDS).toEqual([]);
    for (const entityId of ["PL", "CS", "HU", "RO", "BG", "YU"] as const) {
      expect(EUROPE_1953_MACRO_ENTITY_IDS).not.toContain(entityId);
      expect(getWorldEntityOrThrow("1953-default", entityId)).toMatchObject({
        simulationTier: "full-autonomous",
        economicArchetype: "planned",
        legacyAccess: "economy-preview",
      });
    }
  });

  it("keeps planned market leakage constant available for dormant planned specs", () => {
    expect(PLANNED_MARKET_LEAKAGE).toBeGreaterThan(0);
    expect(PLANNED_MARKET_LEAKAGE).toBeLessThan(1);
  });

  it("never reports modern-preset fallback on authored seeds", () => {
    for (const country of listEurope1953MacroCountries()) {
      expect(country.presetId).toBe("1953-default");
      expect(country.dataQuality.fallbackFields).toEqual([]);
      expect(country.dataQuality.provenance).toBe("authored-1953");
    }
  });

  it("refuses unknown macro entities instead of inheriting another era", () => {
    expect(() => getEurope1953MacroCountry("XX")).toThrow(/refusing modern-preset fallback/);
  });

  it("exposes per-country missing/fallback diagnostics across the roster", async () => {
    const db = createMockDb();
    db.collection("macroCountries");
    const countries = listEurope1953MacroCountries();
    const findCursor = {
      toArray: vi.fn().mockResolvedValue(countries),
      sort: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      skip: vi.fn().mockReturnThis(),
      project: vi.fn().mockReturnThis(),
    };
    db.collectionMocks.macroCountries!.find.mockReturnValue(findCursor);

    const diagnostics = await getMacroCountryDiagnostics(db as unknown as Db);
    expect(diagnostics).toHaveLength(EUROPE_1953_MACRO_ENTITY_IDS.length);
    for (const row of diagnostics) {
      expect(row.dataQuality.missingFields).toEqual([]);
      expect(row.dataQuality.fallbackFields).toEqual([]);
      expect(row.dataQuality.provenance).toBe("authored-1953");
      expect(row.economicSystem).toBe(row.dataQuality.economicSystem);
    }
  });

  it("keeps Ireland as a 1953 full-autonomous economy-preview", () => {
    const ireland = getWorldEntityOrThrow("1953-default", "IE");
    expect(ireland.simulationTier).toBe("full-autonomous");
    expect(ireland.legacyAccess).toBe("economy-preview");
    expect(ireland.economicArchetype).toBe("market");

    // Later Cold War preset still treats Ireland as economy-preview.
    expect(getWorldEntityOrThrow("1979-default", "IE")).toMatchObject({
      simulationTier: "full-autonomous",
      legacyAccess: "economy-preview",
    });
  });

  it("lists the European sphere-macro set inside the full 1953 manifest macro roster", () => {
    const macros = getWorldEntityPresetManifest("1953-default").entries.filter(
      (e) => e.simulationTier === "sphere-macro"
    );
    const macroIds = macros.map((e) => e.entityId);
    for (const entityId of EUROPE_1953_MACRO_ENTITY_IDS) {
      expect(macroIds).toContain(entityId);
    }
    // Authored Tier-2 seeds are the sovereign macros; emergents (#3726/#3727)
    // also sit at sphere-macro until sovereignty but are not authored seeds.
    const sovereignMacroIds = macros
      .filter((e) => e.status === "sovereign")
      .map((e) => e.entityId)
      .sort();
    expect(sovereignMacroIds).toEqual([...ALL_1953_MACRO_ENTITY_IDS].sort());
    const emergentMacroIds = macros
      .filter((e) => e.status === "emergent")
      .map((e) => e.entityId)
      .sort();
    expect(emergentMacroIds).toEqual(["AO", "CD", "DZ", "GH", "GY", "MZ", "SO", "YD"].sort());
  });
});

describe("Asian / Middle Eastern 1953 Tier-2 roster (#3720)", () => {
  const EXPECTED = [
    "JO",
    "AF",
    "YE",
    "MM",
    "LA",
    "KH",
    "TH",
    "IN",
    "PK",
    "IR",
    "IQ",
    "EG",
    "SA",
    "SY",
    "ID",
    "KP",
    "KR",
    "NVN",
    "SVN",
  ] as const;
  const EXPECTED_PLANNED = ["KP", "NVN"] as const;

  it("classifies every roster country as sphere-macro in the 1953 manifest", () => {
    expect([...ASIA_ME_1953_MACRO_ENTITY_IDS].sort()).toEqual([...EXPECTED].sort());

    for (const entityId of EXPECTED) {
      const entry = getWorldEntityOrThrow("1953-default", entityId);
      expect(entry.simulationTier).toBe("sphere-macro");
      expect(entry.legacyAccess).toBe("hidden");
      expect(entry.countryId).toBeUndefined();
      if ((EXPECTED_PLANNED as readonly string[]).includes(entityId)) {
        expect(entry.economicArchetype).toBe("planned");
      } else {
        expect(entry.economicArchetype).toBe("market");
      }
    }
  });

  it("seeds every roster country as Tier 2 with authored 1953 inputs", () => {
    for (const entityId of ASIA_ME_1953_MACRO_ENTITY_IDS) {
      const country = getAsiaMiddleEast1953MacroCountry(entityId);
      expectOracleInvariants(country, entityId);
      if ((EXPECTED_PLANNED as readonly string[]).includes(entityId)) {
        expect(country.economicSystem).toBe("planned");
      } else {
        expect(country.economicSystem).toBe("market");
      }
    }
  });

  it("keeps era-correct population and contribution determinism", () => {
    const jordan = getAsiaMiddleEast1953MacroCountry("JO");
    expect(jordan.population).toBe(1_400_000);
    expect(jordan.displayName).toBe("Jordan");

    const yemen = getAsiaMiddleEast1953MacroCountry("YE");
    expect(yemen.displayName).toBe("North Yemen");
    expect(yemen.population).toBe(4_500_000);

    const burma = getAsiaMiddleEast1953MacroCountry("MM");
    expect(burma.displayName).toBe("Burma");
    expect(burma.population).toBe(19_100_000);

    for (const country of listAsiaMiddleEast1953MacroCountries()) {
      const recomputed = computeMacroContribution(country, 1);
      expect(recomputed.byCommodity).toEqual(country.contribution.byCommodity);
      expect(recomputed.bySector).toEqual(country.contribution.bySector);
    }
  });

  it("never reports modern-preset fallback on authored seeds", () => {
    for (const country of listAsiaMiddleEast1953MacroCountries()) {
      expect(country.presetId).toBe("1953-default");
      expect(country.dataQuality.fallbackFields).toEqual([]);
      expect(country.dataQuality.missingFields).toEqual([]);
      expect(country.dataQuality.provenance).toBe("authored-1953");
    }
  });

  it("refuses unknown macro entities instead of inheriting another era", () => {
    expect(() => getAsiaMiddleEast1953MacroCountry("XX")).toThrow(
      /refusing modern-preset fallback/
    );
    expect(() => getAuthored1953MacroCountry("XX")).toThrow(/refusing modern-preset fallback/);
  });

  it("exposes per-country missing/fallback diagnostics across the roster", async () => {
    const db = createMockDb();
    db.collection("macroCountries");
    const countries = listAsiaMiddleEast1953MacroCountries();
    const findCursor = {
      toArray: vi.fn().mockResolvedValue(countries),
      sort: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      skip: vi.fn().mockReturnThis(),
      project: vi.fn().mockReturnThis(),
    };
    db.collectionMocks.macroCountries!.find.mockReturnValue(findCursor);

    const diagnostics = await getMacroCountryDiagnostics(db as unknown as Db);
    expect(diagnostics).toHaveLength(ASIA_ME_1953_MACRO_ENTITY_IDS.length);
    for (const row of diagnostics) {
      expect(row.dataQuality.missingFields).toEqual([]);
      expect(row.dataQuality.fallbackFields).toEqual([]);
      expect(row.dataQuality.provenance).toBe("authored-1953");
      expect(row.economicSystem).toBe(row.dataQuality.economicSystem);
    }
  });

  it("bounds market contributions under full trade exposure", () => {
    for (const country of listAsiaMiddleEast1953MacroCountries()) {
      const full = computeMacroContribution({ ...country, tradeExposure: 1 }, 1);
      let fullFlow = 0;
      for (const bal of Object.values(full.byCommodity)) {
        expect(bal!.supply).toBeGreaterThanOrEqual(0);
        expect(bal!.demand).toBeGreaterThanOrEqual(0);
        expect(Number.isFinite(bal!.supply)).toBe(true);
        expect(Number.isFinite(bal!.demand)).toBe(true);
        fullFlow += (bal?.supply ?? 0) + (bal?.demand ?? 0);
      }
      expect(fullFlow).toBeGreaterThan(0);

      // Authored exposure must remain a strict fraction of full exposure.
      const authored = computeMacroContribution(country, 1);
      let authoredFlow = 0;
      for (const bal of Object.values(authored.byCommodity)) {
        authoredFlow += (bal?.supply ?? 0) + (bal?.demand ?? 0);
      }
      expect(Object.keys(authored.byCommodity).length).toBeGreaterThan(0);
      expect(authoredFlow).toBeGreaterThan(0);
      expect(authoredFlow).toBeLessThan(fullFlow);
    }
  });

  it("unions with Europe into the authored 1953 macro roster", () => {
    expect(ALL_1953_MACRO_ENTITY_IDS).toEqual(
      expect.arrayContaining([...EUROPE_1953_MACRO_ENTITY_IDS, ...ASIA_ME_1953_MACRO_ENTITY_IDS])
    );
    expect(ALL_1953_MACRO_ENTITY_IDS.length).toBeGreaterThanOrEqual(
      EUROPE_1953_MACRO_ENTITY_IDS.length + ASIA_ME_1953_MACRO_ENTITY_IDS.length
    );
    expect(listAll1953MacroCountries()).toHaveLength(ALL_1953_MACRO_ENTITY_IDS.length);
  });
});

describe("African / American 1953 Tier-2 roster (#3721)", () => {
  const EXPECTED = ["ET", "ZA", "CU", "GT", "PA", "NI", "CL", "AR", "MX", "VE"] as const;

  it("classifies every roster country as sphere-macro in the 1953 manifest", () => {
    expect([...AFRICA_AMERICAS_1953_MACRO_ENTITY_IDS].sort()).toEqual([...EXPECTED].sort());

    for (const entityId of EXPECTED) {
      const entry = getWorldEntityOrThrow("1953-default", entityId);
      expect(entry.simulationTier).toBe("sphere-macro");
      expect(entry.legacyAccess).toBe("hidden");
      expect(entry.economicArchetype).toBe("market");
      expect(entry.status).toBe("sovereign");
      expect(entry.countryId).toBeUndefined();
    }
  });

  it("seeds every roster country as Tier 2 with authored 1953 inputs", () => {
    for (const entityId of AFRICA_AMERICAS_1953_MACRO_ENTITY_IDS) {
      const country = getAfricaAmericas1953MacroCountry(entityId);
      expectOracleInvariants(country, entityId);
      expect(country.economicSystem).toBe("market");
    }
  });

  it("keeps era-correct population and contribution determinism", () => {
    const ethiopia = getAfricaAmericas1953MacroCountry("ET");
    expect(ethiopia.population).toBe(18_500_000);
    expect(ethiopia.displayName).toBe("Ethiopia");

    const southAfrica = getAfricaAmericas1953MacroCountry("ZA");
    expect(southAfrica.displayName).toBe("South Africa");
    expect(southAfrica.population).toBe(13_200_000);

    const mexico = getAfricaAmericas1953MacroCountry("MX");
    expect(mexico.displayName).toBe("Mexico");
    expect(mexico.population).toBe(28_000_000);

    const venezuela = getAfricaAmericas1953MacroCountry("VE");
    expect(venezuela.displayName).toBe("Venezuela");
    expect(venezuela.resources.oil).toBeGreaterThan(0);

    for (const country of listAfricaAmericas1953MacroCountries()) {
      const recomputed = computeMacroContribution(country, 1);
      expect(recomputed.byCommodity).toEqual(country.contribution.byCommodity);
      expect(recomputed.bySector).toEqual(country.contribution.bySector);
    }
  });

  it("never reports modern-preset fallback on authored seeds", () => {
    for (const country of listAfricaAmericas1953MacroCountries()) {
      expect(country.presetId).toBe("1953-default");
      expect(country.dataQuality.fallbackFields).toEqual([]);
      expect(country.dataQuality.missingFields).toEqual([]);
      expect(country.dataQuality.provenance).toBe("authored-1953");
    }
  });

  it("refuses unknown macro entities instead of inheriting another era", () => {
    expect(() => getAfricaAmericas1953MacroCountry("XX")).toThrow(
      /refusing modern-preset fallback/
    );
    expect(() => getAuthored1953MacroCountry("XX")).toThrow(/refusing modern-preset fallback/);
  });

  it("exposes per-country missing/fallback diagnostics across the roster", async () => {
    const db = createMockDb();
    db.collection("macroCountries");
    const countries = listAfricaAmericas1953MacroCountries();
    const findCursor = {
      toArray: vi.fn().mockResolvedValue(countries),
      sort: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      skip: vi.fn().mockReturnThis(),
      project: vi.fn().mockReturnThis(),
    };
    db.collectionMocks.macroCountries!.find.mockReturnValue(findCursor);

    const diagnostics = await getMacroCountryDiagnostics(db as unknown as Db);
    expect(diagnostics).toHaveLength(AFRICA_AMERICAS_1953_MACRO_ENTITY_IDS.length);
    for (const row of diagnostics) {
      expect(row.dataQuality.missingFields).toEqual([]);
      expect(row.dataQuality.fallbackFields).toEqual([]);
      expect(row.dataQuality.provenance).toBe("authored-1953");
      expect(row.economicSystem).toBe("market");
    }
  });

  it("bounds market contributions under full trade exposure", () => {
    for (const country of listAfricaAmericas1953MacroCountries()) {
      const full = computeMacroContribution({ ...country, tradeExposure: 1 }, 1);
      let fullFlow = 0;
      for (const bal of Object.values(full.byCommodity)) {
        expect(bal!.supply).toBeGreaterThanOrEqual(0);
        expect(bal!.demand).toBeGreaterThanOrEqual(0);
        expect(Number.isFinite(bal!.supply)).toBe(true);
        expect(Number.isFinite(bal!.demand)).toBe(true);
        fullFlow += (bal?.supply ?? 0) + (bal?.demand ?? 0);
      }
      expect(fullFlow).toBeGreaterThan(0);

      const authored = computeMacroContribution(country, 1);
      let authoredFlow = 0;
      for (const bal of Object.values(authored.byCommodity)) {
        authoredFlow += (bal?.supply ?? 0) + (bal?.demand ?? 0);
      }
      expect(Object.keys(authored.byCommodity).length).toBeGreaterThan(0);
      expect(authoredFlow).toBeGreaterThan(0);
      expect(authoredFlow).toBeLessThan(fullFlow);
    }
  });

  // The Soviet union republics are dependent AND full-autonomous: they answer to
  // Moscow but run their own economies and chambers. That combination is unique
  // to them, so they are named out of a sweep that is really about colonies.
  const UNION_REPUBLIC_IDS = ["UKR", "BLR", "BAL"];

  it("keeps African and American 1953 dependencies at Tier 3, not Tier 2", () => {
    const dependents = getWorldEntityPresetManifest("1953-default").entries.filter(
      (entry) => entry.status === "dependent" && !UNION_REPUBLIC_IDS.includes(entry.entityId)
    );
    expect(dependents.length).toBeGreaterThan(0);

    for (const entry of dependents) {
      expect(entry.simulationTier).not.toBe("sphere-macro");
      expect(entry.simulationTier).toBe("historical-presence");
      expect(AFRICA_AMERICAS_1953_MACRO_ENTITY_IDS).not.toContain(entry.entityId);
      expect(ALL_1953_MACRO_ENTITY_IDS).not.toContain(entry.entityId);
    }

    // Colonial dependencies stay Tier-3 historical-presence (Gold Coast, Congo, …).
    // Nigeria is Tier-1 full-autonomous (product decision 2026-07-25), not a dependent.
    expect(getWorldEntityOrThrow("1953-default", "NG")).toMatchObject({
      status: "sovereign",
      simulationTier: "full-autonomous",
      legacyAccess: "economy-preview",
    });
    expect(getWorldEntityOrThrow("1953-default", "NG").parentEntityId).toBeUndefined();

    // Timeline-driven African/American promotions must not sneak into this roster.
    for (const futureId of ["GH", "CD", "DZ", "AO", "MZ", "SO", "GY"] as const) {
      expect(AFRICA_AMERICAS_1953_MACRO_ENTITY_IDS).not.toContain(futureId);
      expect(ALL_1953_MACRO_ENTITY_IDS).not.toContain(futureId);
    }
  });

  it("unions with Europe and Asia/ME into the authored 1953 macro roster", () => {
    expect(ALL_1953_MACRO_ENTITY_IDS).toEqual(
      expect.arrayContaining([
        ...EUROPE_1953_MACRO_ENTITY_IDS,
        ...ASIA_ME_1953_MACRO_ENTITY_IDS,
        ...AFRICA_AMERICAS_1953_MACRO_ENTITY_IDS,
      ])
    );
    expect(ALL_1953_MACRO_ENTITY_IDS).toHaveLength(
      EUROPE_1953_MACRO_ENTITY_IDS.length +
        ASIA_ME_1953_MACRO_ENTITY_IDS.length +
        AFRICA_AMERICAS_1953_MACRO_ENTITY_IDS.length
    );
    expect(listAll1953MacroCountries()).toHaveLength(ALL_1953_MACRO_ENTITY_IDS.length);
  });
});
