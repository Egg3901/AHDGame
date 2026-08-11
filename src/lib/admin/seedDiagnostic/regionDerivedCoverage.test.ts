/**
 * The diagnostic must be able to SEE the region-derived collections.
 *
 * Before these checks existed, `seedDiagnostic/` contained zero mentions of
 * militaryUnits, cabinetEstates, energyPlants, infraProjects, nationalManpower
 * or stateRegistrationPool — so the two largest seed defects on record both
 * passed a clean diagnostic run:
 *
 *   A1: the region-derived seeders ran while only US states existed, leaving
 *       militaryUnits at 13 documents across 1 country in a 226-region,
 *       24-country world. Reported: 0 critical.
 *   A5: `runSeed --reset` emptied stateRegistrationPool (51 -> 0) with nothing
 *       able to rebuild it. Reported: 0 critical.
 *
 * These tests drive the REAL `runConformanceChecks` rather than the private
 * check function, so they fail if the group is ever dropped from the runner —
 * which is how a check stops running without anyone noticing.
 */
import { describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import { runConformanceChecks } from "./conformance";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));

/**
 * A mock world where every collection reports the country coverage given, and
 * everything else falls back to the mock defaults.
 */
function worldWith(coverage: Record<string, string[]>, poolRows = 51): MockDb {
  const db = createMockDb();
  db.collection("gameState").findOne.mockResolvedValue({
    _id: "current",
    preset: "1953-default",
  });
  for (const [collection, countries] of Object.entries(coverage)) {
    db.collection(collection).distinct.mockResolvedValue(countries);
  }
  db.collection("stateRegistrationPool").countDocuments.mockResolvedValue(poolRows);
  return db;
}

const regionDerived = <T extends { id: string }>(checks: T[]) =>
  checks.filter((c) => c.id.startsWith("regionDerived."));

const byId = (checks: { id: string; severity: string; note?: string }[], id: string) =>
  checks.find((c) => c.id === id);

describe("region-derived coverage checks", () => {
  it("runs at all — the group is wired into runConformanceChecks", async () => {
    const db = worldWith({});
    const { checks } = await runConformanceChecks(db as unknown as Db, { preset: "1953-default" });
    expect(regionDerived(checks).length).toBeGreaterThan(0);
  });

  it("flags the A1 shape: a collection seeded for the US alone", async () => {
    // militaryUnits covering only the US is exactly the measured defect
    // (13 docs / 1 country). It must not read as healthy.
    const db = worldWith({ militaryUnits: ["US"] });
    const { checks } = await runConformanceChecks(db as unknown as Db, { preset: "1953-default" });

    const military = byId(checks, "regionDerived.militaryUnits.coverage");
    expect(military).toBeDefined();
    expect(military!.severity).not.toBe("ok");
    // The countries actually missing are named, so the report is actionable.
    expect(military!.note).toMatch(/missing .*(UK|RU|CN)/);
  });

  it("treats a collection that seeded nothing as critical", async () => {
    const db = worldWith({ militaryUnits: [] });
    const { checks } = await runConformanceChecks(db as unknown as Db, { preset: "1953-default" });
    expect(byId(checks, "regionDerived.militaryUnits.coverage")!.severity).toBe("critical");
  });

  it("flags the A5 shape: stateRegistrationPool emptied with no rebuild path", async () => {
    const db = worldWith({}, 0);
    const { checks } = await runConformanceChecks(db as unknown as Db, { preset: "1953-default" });
    expect(byId(checks, "regionDerived.stateRegistrationPool.count")!.severity).toBe("critical");
  });

  it("passes a world whose coverage matches the seeders' own gating config", async () => {
    // Expectations are derived from the same config the seeders gate on, so a
    // healthy world is whatever that config says — asserted here by reading it
    // rather than by restating a roster (a hard-coded roster is what produced
    // the DE RegionMetrics false positive).
    const { buildSeedExpectations, expectedRegionDerivedCoverage } = await import("./expectations");
    const expectations = buildSeedExpectations("1953-default");
    const groups = expectedRegionDerivedCoverage("1953-default", expectations.seededCountryIds);
    const coverage = Object.fromEntries(groups.map((g) => [g.collection, [...g.countries]]));

    const db = worldWith(coverage, 51);
    const { checks } = await runConformanceChecks(db as unknown as Db, { preset: "1953-default" });

    for (const c of regionDerived(checks)) {
      expect(c.severity, `${c.id} should be ok on a fully-covered world`).toBe("ok");
    }
  });

  it("does not invent expectations for a country the preset never seeds", async () => {
    // Era gating: a country with no era-active branches is correctly absent,
    // not missing. Whatever the config excludes must not be demanded.
    const { buildSeedExpectations, expectedRegionDerivedCoverage } = await import("./expectations");
    const expectations = buildSeedExpectations("1953-default");
    const groups = expectedRegionDerivedCoverage("1953-default", expectations.seededCountryIds);
    const military = groups.find((g) => g.collection === "militaryUnits")!;
    const seeded = new Set(expectations.seededCountryIds);
    for (const countryId of military.countries) {
      expect(seeded.has(countryId), `${countryId} expected but not seeded by this preset`).toBe(
        true
      );
    }
  });
});
