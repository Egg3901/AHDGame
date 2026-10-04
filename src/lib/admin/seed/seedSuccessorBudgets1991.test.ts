import { describe, expect, it } from "vitest";
import type { Db } from "mongodb";
import { createInMemoryDb } from "@/lib/test-utils/inMemoryDb";
import { seedSuccessorBudgets1991 } from "./seedSuccessorBudgets1991";

const noop = () => {};

/**
 * RU ownership gap (issue #2316): seedRuBudgets returns on 1991, so
 * seedSuccessorBudgets1991 must produce RU's owned producing SOEs itself via
 * the existing generateCountryOwnedSeedData + upsertCountryOwnedCorpEntries
 * path. Uses the real generator against a real in-memory database: a mocked
 * generator would assert nothing about the actual ownership output.
 */
async function setupWorld(db: Db, commandEconomyEnabled: boolean): Promise<void> {
  const mem = db as unknown as ReturnType<typeof createInMemoryDb>;
  mem.seed("states", [
    { _id: "RU_CEN", countryId: "RU", population: 20_000_000, gdp: 80_000_000_000 },
    { _id: "RU_SIB", countryId: "RU", population: 10_000_000, gdp: 40_000_000_000 },
    // A non-RU successor region: proves the ownership pass is limited to RU.
    { _id: "PL_MAZ", countryId: "PL", population: 5_000_000, gdp: 30_000_000_000 },
  ]);
  mem.seed("gameConfig", [{ _id: "default", commandEconomyEnabled }]);
}

async function ruCorps(db: Db) {
  return db
    .collection<{
      countryOwnerId: string;
      soe?: unknown;
      isPrimaryNationalCorporation?: boolean;
    }>("corporations")
    .find({ countryOwnerId: "RU" })
    .toArray();
}

async function ruSectors(db: Db) {
  return db
    .collection<{
      countryId: string;
      corporationId: unknown;
      stateId: unknown;
      sectorType: unknown;
    }>("corporateSectors")
    .find({ countryId: "RU" })
    .toArray();
}

describe("seedSuccessorBudgets1991 RU ownership", () => {
  it("seeds owned producing RU SOEs when the command-economy flag is on", async () => {
    const db = createInMemoryDb() as unknown as Db;
    await setupWorld(db, true);

    await seedSuccessorBudgets1991(db, false, "1991-default", noop);

    const corps = await ruCorps(db);
    const sectors = await ruSectors(db);
    // Multi-SOE split: the bare sovereign issuer plus one enterprise per
    // commanding-height sector, each carrying the SoeState overlay.
    expect(corps.length).toBeGreaterThan(1);
    expect(corps.filter((c) => c.soe !== undefined).length).toBeGreaterThan(0);
    expect(sectors.length).toBeGreaterThan(0);
    // Every RU producing sector hangs off an RU country-owned corporation.
    const ownerIds = new Set(corps.map((c) => String(c._id)));
    for (const sector of sectors) {
      expect(ownerIds.has(String(sector.corporationId))).toBe(true);
    }
    // The sovereign issuer itself owns nothing in the split shape.
    const primary = corps.find((c) => c.isPrimaryNationalCorporation);
    expect(primary).toBeDefined();
    expect(sectors.filter((s) => String(s.corporationId) === String(primary!._id))).toHaveLength(0);
    // Limited to RU: no other country's enterprises are written.
    const allCorps = await db.collection("corporations").find({}).toArray();
    expect(allCorps.length).toBe(corps.length);
  });

  it("repeat seeding is stable: no duplicate corps or sectors", async () => {
    const db = createInMemoryDb() as unknown as Db;
    await setupWorld(db, true);

    await seedSuccessorBudgets1991(db, true, "1991-default", noop);
    const corpsAfterFirst = await ruCorps(db);
    const sectorsAfterFirst = await ruSectors(db);
    expect(sectorsAfterFirst.length).toBeGreaterThan(0);

    await seedSuccessorBudgets1991(db, false, "1991-default", noop);
    const corpsAfterSecond = await ruCorps(db);
    const sectorsAfterSecond = await ruSectors(db);
    expect(corpsAfterSecond.length).toBe(corpsAfterFirst.length);
    expect(sectorsAfterSecond.length).toBe(sectorsAfterFirst.length);

    // No two producing rows for the same (enterprise, region, sector type).
    const keys = sectorsAfterSecond.map(
      (s) => `${String(s.corporationId)}|${s.stateId}|${s.sectorType}`
    );
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("flag off keeps the legacy single-corp shape, still with owned producing sectors", async () => {
    const db = createInMemoryDb() as unknown as Db;
    await setupWorld(db, false);

    await seedSuccessorBudgets1991(db, false, "1991-default", noop);

    const corps = await ruCorps(db);
    const sectors = await ruSectors(db);
    // Same shape seedRuBudgets produces when the flag is off: one National
    // Corp owning everything, byte-identical fallback.
    expect(corps).toHaveLength(1);
    expect(sectors.length).toBeGreaterThan(0);
    for (const sector of sectors) {
      expect(String(sector.corporationId)).toBe(String(corps[0]._id));
    }
  });

  it("still no-ops on other presets", async () => {
    const db = createInMemoryDb() as unknown as Db;
    await setupWorld(db, true);

    await seedSuccessorBudgets1991(db, false, "2019-default", noop);

    expect(await db.collection("federalBudget").countDocuments()).toBe(0);
    expect(await db.collection("corporations").countDocuments()).toBe(0);
    expect(await db.collection("corporateSectors").countDocuments()).toBe(0);
  });
});
