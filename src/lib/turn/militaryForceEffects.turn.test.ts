import { describe, it, expect } from "vitest";
import type { Db } from "mongodb";
import { applyMilitaryForceEffects } from "./militaryForceEffects";
import { resolveMetricPath } from "@/lib/cabinet/resolveMetricPath";
import { getCabinetMechanics } from "@/lib/constants/cabinetMechanics";
import { ALL_COUNTRY_IDS } from "@/lib/constants/countries";
import { isPoliticalApprovalCountry } from "@/lib/politicalLegislation/politicalApprovalProvider";

interface BulkOp {
  updateOne: { filter: { _id: unknown }; update: { $set: { readiness: number } } };
}

function stubDb(opts: {
  units: Array<Record<string, unknown>>;
  budget: unknown;
  setting?: unknown;
  capture: { ops: BulkOp[] };
}): Db {
  return {
    collection: (name: string) => {
      if (name === "militaryUnits") {
        return {
          find: () => ({ toArray: async () => opts.units }),
          bulkWrite: async (ops: BulkOp[]) => {
            opts.capture.ops = ops;
            return { modifiedCount: ops.length };
          },
        };
      }
      // `updateOne` is required as well as `findOne`: applyMilitaryForceEffects now reads
      // the defence appropriation for the arrears ratio, and that read HEALS an unmigrated
      // budget in place rather than reporting a zero pot.
      if (name === "federalBudget") {
        return {
          findOne: async () => opts.budget,
          updateOne: async () => ({ matchedCount: 1, modifiedCount: 1 }),
        };
      }
      if (name === "cabinetSettings") return { findOne: async () => opts.setting ?? null };
      return { findOne: async () => null };
    },
  } as unknown as Db;
}

describe("applyMilitaryForceEffects", () => {
  it("accumulates Defense metric deltas into the bucket, and leaves readiness alone", async () => {
    const capture = { ops: [] as BulkOp[] };
    const db = stubDb({
      units: [
        {
          _id: "u1",
          countryId: "US",
          branchId: "army",
          domain: "ground",
          name: "x",
          type: "Infantry Division",
          icon: "soldier",
          posture: "standard",
          techTier: 1,
          personnel: 1000,
          readiness: 50,
          basePower: 50,
          upkeepBase: 10000,
          vet: 1,
          xp: 0,
          equipment: { firepower: 1, protection: 1, support: 1 },
          drill: null,
          theaterId: "reserve",
          assignedGeneralId: null,
          createdTurn: 1,
        },
      ],
      budget: { countryId: "US", spending: { byCategory: { defense: 100 } } },
      capture,
    });

    const bucket = {
      national: {} as Record<string, number>,
      regional: {} as Record<string, Record<string, number>>,
    };
    await applyMilitaryForceEffects(db, "US", bucket, "1953-default");

    const mech = getCabinetMechanics("US", "secretary_of_defense")!;
    const metrics = [...mech.nationalMetrics, ...mech.regionalMetrics];
    const budgetPath = resolveMetricPath("governance.budgetBalance", metrics);
    expect(bucket.national[budgetPath]).toBeLessThan(0); // upkeep (10000×2.6≈26,000M) over the floored envelope

    // Drift is NOT this step's job. It moved to the appropriation sweep, which runs for
    // every country rather than only the ones holding a defence seat — see
    // `applyReadinessDrift` and the seatless-arrears case in defenseAppropriationTurn.test.
    expect(capture.ops).toHaveLength(0);
  });

  it("drives the defense political families for a pipeline country", async () => {
    const capture = { ops: [] as BulkOp[] };
    const db = stubDb({
      units: [
        {
          _id: "u1",
          countryId: "US",
          basePower: 100,
          posture: "forward",
          techTier: 3,
          vet: 2,
          readiness: 80,
          equipment: { firepower: 2, protection: 2, support: 2 },
          createdTurn: 1,
        },
      ],
      budget: { countryId: "US", spending: { byCategory: { defense: 100 } } },
      capture,
    });
    const bucket: {
      national: Record<string, number>;
      regional: Record<string, Record<string, number>>;
      politicalDirect?: Record<string, number>;
    } = { national: {}, regional: {} };
    await applyMilitaryForceEffects(db, "US", bucket, "1953-default");

    expect(bucket.politicalDirect).toBeDefined();
    expect(bucket.politicalDirect!["defense.armedForces"]).toBeGreaterThan(0);
    // forward posture → projection > 0.
    expect(bucket.politicalDirect!["defense.projection"]).toBeGreaterThan(0);
    // every key is a defense family.
    expect(Object.keys(bucket.politicalDirect!).every((k) => k.startsWith("defense."))).toBe(true);
  });

  it("does not drive defense families for a non-pipeline country", async () => {
    // The country is DERIVED from the gate, not hardcoded. This test named DE
    // until the political board widened from the four playables to 26 countries
    // and made DE a pipeline country; deriving it keeps the assertion pointed at
    // the invariant rather than at a country that can cross the line later.
    const nonPipeline = ALL_COUNTRY_IDS.find((c) => !isPoliticalApprovalCountry(c));
    expect(nonPipeline).toBeTruthy();

    const capture = { ops: [] as BulkOp[] };
    const db = stubDb({
      units: [
        {
          _id: "u1",
          countryId: nonPipeline,
          basePower: 100,
          posture: "standard",
          techTier: 1,
          vet: 1,
          readiness: 70,
          equipment: { firepower: 1, protection: 1, support: 1 },
          createdTurn: 1,
        },
      ],
      budget: { countryId: nonPipeline, spending: { byCategory: { defense: 100 } } },
      capture,
    });
    const bucket: {
      national: Record<string, number>;
      regional: Record<string, Record<string, number>>;
      politicalDirect?: Record<string, number>;
    } = { national: {}, regional: {} };
    await applyMilitaryForceEffects(db, nonPipeline!, bucket, "1953-default");
    expect(bucket.politicalDirect).toBeUndefined();
  });

  it("is a no-op for a country with no units", async () => {
    const capture = { ops: [] as BulkOp[] };
    const db = stubDb({ units: [], budget: null, capture });
    const bucket = { national: {} as Record<string, number>, regional: {} };
    await applyMilitaryForceEffects(db, "US", bucket, "1953-default");
    expect(Object.keys(bucket.national).length).toBe(0);
    expect(capture.ops.length).toBe(0);
  });

  // 1953 DE has a defense seat but zero era-active branches (Bundeswehr 1955) —
  // force effects must not invent deltas or throw when the roster is empty.
  it("is a no-op for demilitarized DE with a defense seat but empty roster", async () => {
    const capture = { ops: [] as BulkOp[] };
    const db = stubDb({
      units: [],
      budget: { countryId: "DE", spending: { byCategory: { defense: 0 } } },
      capture,
    });
    const bucket = { national: {} as Record<string, number>, regional: {} };
    await applyMilitaryForceEffects(db, "DE", bucket, "1953-default");
    expect(Object.keys(bucket.national)).toEqual([]);
    expect(capture.ops).toEqual([]);
  });
});
