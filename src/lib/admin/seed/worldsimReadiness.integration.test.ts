import { beforeAll, describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { euroMembersAtYear } from "@/lib/currency/rules/eraCurrency";

vi.mock("@/lib/mongodb", async () => {
  const fixture = await import("@/lib/test-utils/__fixtures__/bootstrapProbe");
  return {
    getDb: vi.fn(async () => fixture.currentProbeDb()),
    getMongoClient: vi.fn(async () => ({ db: () => ({ command: async () => ({}) }) })),
  };
});

let db: Db;

beforeAll(async () => {
  const { probeBootstrap } = await import("@/lib/test-utils/__fixtures__/bootstrapProbe");
  db = (await probeBootstrap("2027-default")).db;
}, 600_000);

describe("2027 worldsim readiness", () => {
  it("seeds Turkey with a modern population total", async () => {
    const regions = await db
      .collection<{ population: number }>("states")
      .find({ countryId: "TR" })
      .toArray();
    expect(regions.reduce((sum, region) => sum + region.population, 0)).toBe(83_400_000);
    const { runConformanceChecks } = await import("@/lib/admin/seedDiagnostic/conformance");
    const result = await runConformanceChecks(db, { preset: "2027-default" });
    expect(result.checks.find((check) => check.id === "regions.TR.populationSum")?.severity).toBe(
      "ok"
    );
  });

  it("does not seed unsupported countries into the active world", async () => {
    for (const countryId of ["RU", "PL", "HU", "RO", "BG"]) {
      for (const collection of ["states", "politicalParties", "npps", "federalBudget"]) {
        expect(
          await db.collection(collection).countDocuments({ countryId }),
          `${collection}.${countryId}`
        ).toBe(0);
      }
    }
  });

  it("seeds euro members with a single EUR denomination", async () => {
    for (const countryId of euroMembersAtYear(2027)) {
      const budget = await db.collection("federalBudget").findOne({ countryId });
      expect(budget?.currencyCode, `federalBudget.${countryId}`).toBe("EUR");
      const rate = await db
        .collection<{ _id: string; currencyCode?: string }>("exchangeRates")
        .findOne({ _id: countryId });
      expect(rate?.currencyCode, `exchangeRates.${countryId}`).toBe("EUR");
      expect(
        await db.collection("corporations").countDocuments({
          countryId,
          liquidCurrencyCode: { $ne: "EUR" },
        }),
        `corporations.${countryId}`
      ).toBe(0);
      expect(
        await db.collection("bonds").countDocuments({ countryId, currencyCode: { $ne: "EUR" } }),
        `bonds.${countryId}`
      ).toBe(0);
    }
  });

  it("does not scale a completed currency conversion twice", async () => {
    const before = await db.collection("federalBudget").findOne({ countryId: "IT" });
    const stateBefore = await db.collection("stateBudgets").findOne({ countryId: "IT" });
    expect(before).not.toBeNull();
    expect(stateBefore).not.toBeNull();
    const { applyEraCurrencyTopology } = await import("./applyEraCurrencyTopology");
    await applyEraCurrencyTopology(db, "2027-default", () => undefined);
    const after = await db.collection("federalBudget").findOne({ countryId: "IT" });
    const stateAfter = await db.collection("stateBudgets").findOne({ countryId: "IT" });
    expect(after?.gdp).toBe(before?.gdp);
    expect(stateAfter?.stateGdp).toBe(stateBefore?.stateGdp);
  });

  it("compares euro budgets in the persisted denomination", async () => {
    const { runConformanceChecks } = await import("@/lib/admin/seedDiagnostic/conformance");
    const result = await runConformanceChecks(db, { preset: "2027-default" });
    expect(
      result.checks.filter(
        (check) =>
          check.severity === "critical" &&
          /^budget\.(AT|DE|ES|FI|FR|GR|IE|IT)\.(gdp|debt\.principal)$/.test(check.id)
      )
    ).toEqual([]);
  });
});
