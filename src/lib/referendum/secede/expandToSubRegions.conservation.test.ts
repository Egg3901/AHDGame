/**
 * End-to-end conservation test for SCO secession, run against a compact
 * in-memory store (the repo's MockDb doesn't persist). Verifies the full data
 * fan-out + economy promotion: sub-regions stand up, the aggregate is gone,
 * additive quantities are conserved, and re-firing is a no-op.
 */
import { describe, it, expect } from "vitest";
import { type Db } from "mongodb";
import { expandToSubRegions } from "./expandToSubRegions";
import { promoteEconomyToNational } from "./promoteEconomyToNational";
import { scoRegions } from "@/lib/seeds/sco/scoRegions";

type Doc = Record<string, unknown>;

function matches(doc: Doc, filter: Doc): boolean {
  for (const [k, v] of Object.entries(filter)) {
    if (v && typeof v === "object" && "$in" in (v as object)) {
      if (!(v as { $in: unknown[] }).$in.includes(doc[k])) return false;
    } else if (doc[k] !== v) {
      return false;
    }
  }
  return true;
}

function makeStore(seed: Record<string, Doc[]>): { db: Db; cols: Record<string, Doc[]> } {
  const cols: Record<string, Doc[]> = {};
  for (const [name, docs] of Object.entries(seed)) cols[name] = docs.map((d) => structuredClone(d));
  const col = (name: string) => (cols[name] ??= []);
  const collection = (name: string) => ({
    find: (filter: Doc = {}) => ({
      sort: () => collection(name).find(filter),
      limit: () => collection(name).find(filter),
      project: () => collection(name).find(filter),
      toArray: async () => col(name).filter((d) => matches(d, filter)),
    }),
    findOne: async (filter: Doc = {}) => col(name).find((d) => matches(d, filter)) ?? null,
    insertOne: async (doc: Doc) => {
      col(name).push(doc);
      return { insertedId: doc._id };
    },
    insertMany: async (docs: Doc[]) => {
      for (const d of docs) col(name).push(d);
      return { insertedIds: {} };
    },
    updateOne: async (filter: Doc, update: Doc) => {
      const hit = col(name).find((d) => matches(d, filter));
      if (hit && update.$set) {
        for (const [k, v] of Object.entries(update.$set as Doc)) {
          if (k.includes(".")) {
            const parts = k.split(".");
            let cur = hit;
            for (let i = 0; i < parts.length - 1; i++) cur = cur[parts[i]] as Doc;
            cur[parts[parts.length - 1]] = v;
          } else {
            hit[k] = v;
          }
        }
        return { matchedCount: 1, modifiedCount: 1 };
      }
      return { matchedCount: 0, modifiedCount: 0 };
    },
    updateMany: async (filter: Doc, update: Doc) => {
      let n = 0;
      for (const d of col(name))
        if (matches(d, filter)) {
          if (update.$set) Object.assign(d, update.$set);
          n++;
        }
      return { matchedCount: n, modifiedCount: n };
    },
    deleteOne: async (filter: Doc) => {
      const i = col(name).findIndex((d) => matches(d, filter));
      if (i >= 0) {
        col(name).splice(i, 1);
        return { deletedCount: 1 };
      }
      return { deletedCount: 0 };
    },
  });
  return { db: { collection } as unknown as Db, cols };
}

function seedWorld() {
  const maleVec = Array.from({ length: 101 }, (_, i) => 100 + i);
  const femaleVec = Array.from({ length: 101 }, (_, i) => 120 + i);
  return makeStore({
    states: [
      { _id: "SCO", countryId: "UK", regionType: "nation", population: 5_440_000, gdp: 163_000 },
      { _id: "LON", countryId: "UK", regionType: "region", population: 9_000_000, gdp: 837_000 },
    ],
    macroMetrics: [{ _id: "SCO", countryId: "UK", approval: 47, growth: 1.5 }],
    regionDemographics: [
      { _id: "SCO", countryId: "UK", ages: { male: maleVec, female: femaleVec } },
    ],
    stateRegistrationPool: [
      { _id: "UK_SCO", countryId: "UK", stateId: "SCO", independent: 35, unregistered: 18 },
    ],
    corporateSectors: Array.from({ length: 12 }, (_, i) => ({
      _id: `sec${i}`,
      countryId: "UK",
      stateId: "SCO",
      revenue: 50 + i,
    })),
    characters: [{ _id: "char1", homeState: "SCO", countryId: "UK" }],
    statePolicies: [{ _id: "pol1", countryId: "UK", stateId: "SCO" }],
    regionalBudgets: [
      {
        _id: "SCO",
        countryId: "UK",
        turn: 3,
        totalBudget: 1_000,
        surplus: 100,
        isOverBudget: false,
      },
    ],
    federalBudget: [
      {
        _id: "UK",
        countryId: "UK",
        fiscalYear: 2020,
        taxBases: { income: 1000 },
        treasuryBalance: -500,
        debt: { principal: 500, interestRate: 3 },
        gdp: 1000,
        currencyCode: "GBP",
      },
    ],
  });
}

describe("SCO secession — expansion + economy conservation", () => {
  it("fans out the aggregate, promotes the economy, and conserves the totals", async () => {
    const { db, cols } = seedWorld();
    const maleVec = (cols.regionDemographics[0].ages as { male: number[] }).male.slice();
    const femaleVec = (cols.regionDemographics[0].ages as { female: number[] }).female.slice();

    await expandToSubRegions(db, "SCO");
    await promoteEconomyToNational(db, "UK", "SCO");

    const ids = scoRegions.map((s) => s._id);

    // states: 7 SCO sub-regions, no aggregate.
    const scoStates = cols.states.filter((s) => s.countryId === "SCO");
    expect(scoStates.map((s) => s._id).sort()).toEqual([...ids].sort());
    expect(cols.states.find((s) => s._id === "SCO" && s.regionType === "nation")).toBeUndefined();

    // macroMetrics cloned to each sub-region, none left on the aggregate.
    expect(cols.macroMetrics.map((m) => m._id).sort()).toEqual([...ids].sort());

    // regionDemographics: every cohort index conserves.
    const demo = cols.regionDemographics as Array<{ ages: { male: number[]; female: number[] } }>;
    for (let i = 0; i < maleVec.length; i++) {
      expect(demo.reduce((s, d) => s + d.ages.male[i], 0)).toBe(maleVec[i]);
      expect(demo.reduce((s, d) => s + d.ages.female[i], 0)).toBe(femaleVec[i]);
    }

    // sectors: every one reassigned off the aggregate.
    expect(cols.corporateSectors.every((s) => s.stateId !== "SCO")).toBe(true);
    expect(cols.corporateSectors.every((s) => ids.includes(s.stateId as string))).toBe(true);

    // pool re-keyed; old composite gone.
    expect(cols.stateRegistrationPool.map((p) => p._id).sort()).toEqual(
      ids.map((id) => `SCO_${id}`).sort()
    );
    expect(cols.stateRegistrationPool.every((p) => p.independent === 35)).toBe(true);

    // residents + devolved artifacts re-homed to the capital, flipped to SCO.
    expect(cols.characters[0]).toMatchObject({ homeState: "LOT", countryId: "SCO" });
    expect(cols.statePolicies[0]).toMatchObject({ stateId: "LOT", countryId: "SCO" });

    // economy: new budget exists, treasury/taxBases/debt conserve.
    const sco = cols.federalBudget.find((b) => b._id === "SCO") as {
      taxBases: { income: number };
      treasuryBalance: number;
      debt: { principal: number };
      currencyCode: string;
    };
    const uk = cols.federalBudget.find((b) => b._id === "UK") as {
      taxBases: { income: number };
      treasuryBalance: number;
      debt: { principal: number };
    };
    expect(sco.currencyCode).toBe("GBP");
    expect(sco.taxBases.income + uk.taxBases.income).toBeCloseTo(1000, 6);
    expect(sco.treasuryBalance + uk.treasuryBalance).toBeCloseTo(-500, 6);
    expect(sco.debt.principal + uk.debt.principal).toBeCloseTo(500, 6);
  });

  it("is idempotent — re-firing both steps changes nothing", async () => {
    const { db, cols } = seedWorld();
    await expandToSubRegions(db, "SCO");
    await promoteEconomyToNational(db, "UK", "SCO");
    const statesAfter = cols.states.length;
    const budgetsAfter = cols.federalBudget.length;

    await expandToSubRegions(db, "SCO");
    await promoteEconomyToNational(db, "UK", "SCO");

    expect(cols.states.length).toBe(statesAfter);
    expect(cols.federalBudget.length).toBe(budgetsAfter);
  });
});
