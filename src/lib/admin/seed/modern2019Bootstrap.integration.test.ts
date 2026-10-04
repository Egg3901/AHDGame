import { expect, it, vi } from "vitest";
import { MODERN_2019_NATIONALS, modernRegions2019 } from "@/lib/seeds/reference/modernRegions2019";

vi.mock("@/lib/mongodb", async () => {
  const fixture = await import("@/lib/test-utils/__fixtures__/bootstrapProbe");
  return {
    getDb: vi.fn(async () => fixture.currentProbeDb()),
    getMongoClient: vi.fn(async () => ({ db: () => ({ command: async () => ({}) }) })),
  };
});

// Model a database created before the industry-model index migration. The
// in-memory driver intentionally throws a plain Error for absent dropIndex,
// while Mongo reports code 27, which the migration correctly treats as absent.
vi.mock("@/lib/test-utils/inMemoryDb", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/test-utils/inMemoryDb")>();
  return {
    ...actual,
    createInMemoryDb: (...args: Parameters<typeof actual.createInMemoryDb>) => {
      const memory = actual.createInMemoryDb(...args);
      const db = memory as unknown as import("mongodb").Db;
      void db
        .collection("corporateSectors")
        .createIndex(
          { corporationId: 1, stateId: 1, sectorType: 1 },
          { name: "corporateSectors_corporationId_stateId_sectorType", unique: true }
        );
      void db
        .collection("unownedSectors")
        .createIndex(
          { stateId: 1, sectorType: 1 },
          { name: "stateId_1_sectorType_1", unique: true }
        );
      void db
        .collection("unions")
        .createIndex(
          { countryId: 1, sectorType: 1 },
          { name: "unions_country_sectorType_seeded_unique", unique: true }
        );
      return memory;
    },
  };
});

it("builds the five 2019 transition countries before region-derived stages", async () => {
  const { probeBootstrap } = await import("@/lib/test-utils/__fixtures__/bootstrapProbe");
  const { db } = await probeBootstrap("2019-default");
  for (const countryId of Object.keys(MODERN_2019_NATIONALS) as Array<
    keyof typeof MODERN_2019_NATIONALS
  >) {
    const regionCount = modernRegions2019(countryId).length;
    expect(await db.collection("states").countDocuments({ countryId })).toBe(regionCount);
    expect(await db.collection("macroMetrics").countDocuments({ countryId })).toBe(regionCount);
    expect(await db.collection("stateDemographics").countDocuments({ countryId })).toBe(
      regionCount
    );
    expect(await db.collection("politicalParties").countDocuments({ countryId })).toBeGreaterThan(
      0
    );
    expect(await db.collection("unownedSectors").countDocuments({ countryId })).toBeGreaterThan(0);
    expect(await db.collection("federalBudget").countDocuments({ countryId })).toBe(1);
    expect(await db.collection("stateBudgets").countDocuments({ countryId })).toBe(regionCount);
  }
  expect(
    await db
      .collection("corporations")
      .findOne({ countryOwnerId: "RU", isPrimaryNationalCorporation: true })
  ).toMatchObject({ name: "Russian Federation", liquidCurrencyCode: "RUB" });
  expect(
    await db
      .collection("corporateSectors")
      .countDocuments({ countryId: "RU", corporationId: { $exists: true } })
  ).toBe(0);
  const { runConformanceChecks } = await import("@/lib/admin/seedDiagnostic/conformance");
  const { checks } = await runConformanceChecks(db, { preset: "2019-default" });
  const critical = checks.filter((check) => check.severity === "critical");
  // Reference bootstrap now supplies canonical seats, so the integrated
  // transition countries must have no critical readiness findings.
  expect(critical.map((check) => check.id).sort()).toEqual([]);
}, 1_800_000);
