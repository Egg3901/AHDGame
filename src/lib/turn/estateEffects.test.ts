import { describe, it, expect, vi } from "vitest";
import { ObjectId } from "mongodb";
import type { Db } from "mongodb";
import { computeEstateDeltas, driftCondition, applyEstateEffects } from "./estateEffects";
import type { CabinetEstate } from "@/lib/db/types/cabinetEstate";
import { createMockDb } from "@/lib/test-utils/mockDb";
import { ESTATE_CATALOG, ESTATE_PORTFOLIO_BY_COUNTRY } from "@/lib/constants/cabinetEstates";
import { CABINET_KEY_TO_POLITICAL } from "@/lib/politicalMetrics/cabinetResidual";
import { isMacroMetricPath } from "@/lib/macroMetrics/paths";

function estate(p: Partial<CabinetEstate>): CabinetEstate {
  return {
    _id: new ObjectId(),
    countryId: "US",
    portfolioKey: "education",
    positionId: "secretary_of_education",
    archetypeId: "public_school",
    name: "S",
    icon: "school",
    fundingLevel: "standard",
    tier: 0,
    condition: 100,
    outputBase: 5000,
    upkeepBase: 60,
    siteScope: "region",
    siteId: "US-CA",
    createdTurn: 1,
    ...p,
  };
}

describe("computeEstateDeltas", () => {
  it("returns archetype effects scaled by tier/funding/condition", () => {
    const d = computeEstateDeltas(estate({}));
    expect(d["education.highSchoolGradRate"]).toBeCloseTo(0.02, 5);
    const half = computeEstateDeltas(estate({ condition: 50 }));
    expect(half["education.highSchoolGradRate"]).toBeCloseTo(0.01, 5);
    const t2 = computeEstateDeltas(estate({ tier: 2 }));
    expect(t2["education.highSchoolGradRate"]).toBeCloseTo(0.04, 5);
  });
  it("returns {} for an unknown archetype", () => {
    expect(computeEstateDeltas(estate({ archetypeId: "nope" }))).toEqual({});
  });
});

describe("driftCondition", () => {
  it("moves one bounded step toward the funding baseline", () => {
    expect(driftCondition(100, "reduced")).toBe(96);
    expect(driftCondition(40, "standard")).toBe(44);
    expect(driftCondition(75, "standard")).toBe(75);
    expect(driftCondition(56, "reduced")).toBe(55);
  });
});

/** Wire a cabinetEstates.find().toArray() + federalBudget.findOne() onto a MockDb. */
function dbWith(estates: CabinetEstate[], budget: unknown) {
  const db = createMockDb();
  const estatesCol = db.collection("cabinetEstates");
  estatesCol.find = vi.fn().mockReturnValue({ toArray: async () => estates });
  const budgetCol = db.collection("federalBudget");
  budgetCol.findOne = vi.fn().mockResolvedValue(budget);
  return db as unknown as Db;
}

describe("applyEstateEffects routing", () => {
  it("domestic estates tilt their sited region; a large envelope yields a positive budget balance", async () => {
    // Education envelope $1T (absolute) ≫ a couple estates' upkeep (~200M) → under budget.
    const db = dbWith(
      [estate({ siteId: "US-CA" }), estate({ siteId: "US-CA", archetypeId: "university" })],
      { spending: { byCategory: { education: 1_000_000_000_000 } } }
    );
    const bucket = {
      national: {} as Record<string, number>,
      regional: {} as Record<string, Record<string, number>>,
    };
    await applyEstateEffects(db, "US", "secretary_of_education", bucket);
    expect(bucket.regional["US-CA"]["education.highSchoolGradRate"]).toBeGreaterThan(0);
    expect(bucket.national["governance.budgetBalance"]).toBeGreaterThan(0);
  });

  it("over-budget upkeep yields a negative budget balance (unit normalization)", async () => {
    // The discretionary envelope floors at the band floor (≈3,500M); a roster whose upkeep
    // exceeds it (2 × 2,500M) overspends → negative budget balance.
    const db = dbWith(
      [
        estate({ siteId: "US-CA", upkeepBase: 2500 }),
        estate({ siteId: "US-CA", archetypeId: "university", upkeepBase: 2500 }),
      ],
      { spending: { byCategory: { education: 1_000_000 } } }
    );
    const bucket = {
      national: {} as Record<string, number>,
      regional: {} as Record<string, Record<string, number>>,
    };
    await applyEstateEffects(db, "US", "secretary_of_education", bucket);
    expect(bucket.national["governance.budgetBalance"]).toBeLessThan(0);
  });

  it("foreign estates tilt national soft-power, never a region", async () => {
    const db = dbWith(
      [
        estate({
          portfolioKey: "foreign",
          positionId: "secretary_of_state",
          archetypeId: "embassy",
          siteScope: "country",
          siteId: "UK",
        }),
      ],
      { gdp: 200000 }
    );
    const bucket = {
      national: {} as Record<string, number>,
      regional: {} as Record<string, Record<string, number>>,
    };
    await applyEstateEffects(db, "US", "secretary_of_state", bucket);
    expect(bucket.national["governance.governmentTransparency"]).toBeGreaterThan(0);
    expect(bucket.regional["UK"]).toBeUndefined();
  });

  it("no-op for an out-of-scope seat", async () => {
    const db = dbWith([estate({})], { gdp: 100000 });
    const bucket = {
      national: {} as Record<string, number>,
      regional: {} as Record<string, Record<string, number>>,
    };
    await applyEstateEffects(db, "US", "secretary_of_defense", bucket);
    expect(Object.keys(bucket.national)).toHaveLength(0);
    expect(Object.keys(bucket.regional)).toHaveLength(0);
  });
});

/**
 * Ticket #1129 guard. `ministerialOrderProcessing` routes every accumulated
 * cabinet delta through exactly two doors: `isMacroMetricPath` ($inc into
 * macroMetrics) and `CABINET_KEY_TO_POLITICAL` (the political board). A path
 * through NEITHER is dropped without an error, so the player builds the estate,
 * pays the upkeep, and nothing moves — which is what ticket #1129 reported.
 *
 * This asserts the catalog and the routers agree, so a new archetype whose
 * effect targets an unmapped metric fails here rather than shipping inert.
 */
describe("ticket #1129 — every estate effect reaches a store", () => {
  function bareKey(path: string): string {
    const parts = path.split(".");
    const tail = parts[parts.length - 1] === "value" ? parts.slice(0, -1) : parts;
    return tail[tail.length - 1] ?? path;
  }

  /** portfolioKey → the political-pipeline countries that can build it. */
  function politicalOwners(): Map<string, string[]> {
    const owners = new Map<string, string[]>();
    for (const cid of ["US", "UK", "RU", "DD"] as const) {
      for (const portfolioKey of Object.values(ESTATE_PORTFOLIO_BY_COUNTRY[cid] ?? {})) {
        const list = owners.get(portfolioKey) ?? [];
        if (!list.includes(cid)) list.push(cid);
        owners.set(portfolioKey, list);
      }
    }
    return owners;
  }

  it("no archetype a political country can build has an unroutable effect", () => {
    const owners = politicalOwners();
    const orphans: string[] = [];

    for (const [portfolio, archetypes] of Object.entries(ESTATE_CATALOG)) {
      if (!owners.has(portfolio)) continue;
      for (const archetype of archetypes) {
        for (const path of Object.keys(archetype.effects)) {
          if (isMacroMetricPath(path) || CABINET_KEY_TO_POLITICAL[bareKey(path)]) continue;
          orphans.push(`${portfolio}/${archetype.id} → ${path}`);
        }
      }
    }

    expect(orphans).toEqual([]);
  });
});
