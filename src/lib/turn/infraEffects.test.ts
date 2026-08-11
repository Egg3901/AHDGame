import { describe, it, expect, vi } from "vitest";
import { ObjectId } from "mongodb";
import type { Db } from "mongodb";
import { computeProjectDeltas, advanceProgress, applyInfraEffects } from "./infraEffects";
import type { InfraProject } from "@/lib/db/types/infraProject";
import { createMockDb } from "@/lib/test-utils/mockDb";

function project(p: Partial<InfraProject>): InfraProject {
  return {
    _id: new ObjectId(),
    countryId: "US",
    positionId: "secretary_of_transportation",
    archetypeId: "highway",
    name: "P",
    icon: "road",
    regionId: "US-CA",
    status: "construction",
    progress: 0,
    buildDuration: 6,
    fundingLevel: "standard",
    outputBase: 500,
    upkeepBase: 40,
    constructionCostBase: 120,
    createdTurn: 1,
    ...p,
  };
}

describe("computeProjectDeltas", () => {
  it("emits archetype effects only for operational projects", () => {
    expect(computeProjectDeltas(project({ status: "construction" }))).toEqual({});
    const d = computeProjectDeltas(project({ status: "operational" }));
    expect(d["infrastructure.roadCondition"]).toBeCloseTo(0.02, 5);
    expect(d["infrastructure.infrastructureInvestmentGap"]).toBeCloseTo(-0.015, 5);
  });
  it("{} for unknown archetype", () => {
    expect(computeProjectDeltas(project({ status: "operational", archetypeId: "nope" }))).toEqual(
      {}
    );
  });
});

describe("advanceProgress", () => {
  it("advances by build speed and reports completion at duration", () => {
    expect(
      advanceProgress(project({ progress: 0, buildDuration: 6, fundingLevel: "standard" }))
    ).toEqual({ progress: 1, completed: false });
    expect(
      advanceProgress(project({ progress: 5, buildDuration: 6, fundingLevel: "standard" }))
    ).toEqual({ progress: 6, completed: true });
    const crashed = advanceProgress(
      project({ progress: 0, buildDuration: 6, fundingLevel: "crashed" })
    );
    expect(crashed.progress).toBeCloseTo(1.8, 5);
  });
});

function dbWith(projects: InfraProject[], budget: unknown) {
  const db = createMockDb();
  db.collection("infraProjects").find = vi.fn().mockReturnValue({ toArray: async () => projects });
  db.collection("federalBudget").findOne = vi.fn().mockResolvedValue(budget);
  return db as unknown as Db;
}

describe("applyInfraEffects", () => {
  it("operational projects tilt their region; construction does not; budget tilts national", async () => {
    const db = dbWith(
      [
        project({ status: "operational", regionId: "US-CA" }),
        project({ status: "construction", regionId: "US-NY" }),
      ],
      { spending: { byCategory: { transportation: 1_000_000_000_000 } } }
    );
    const bucket = {
      national: {} as Record<string, number>,
      regional: {} as Record<string, Record<string, number>>,
    };
    await applyInfraEffects(db, "US", "secretary_of_transportation", bucket, 10);
    expect(bucket.regional["US-CA"]["infrastructure.roadCondition"]).toBeGreaterThan(0);
    expect(bucket.regional["US-NY"]).toBeUndefined();
    expect(bucket.national["governance.budgetBalance"]).toBeDefined();
  });
  it("flips a finished construction project to operational (bulk-write) and no-ops a non-transport seat", async () => {
    const finishing = project({
      status: "construction",
      progress: 5,
      buildDuration: 6,
      fundingLevel: "standard",
    });
    const db = dbWith([finishing], { gdp: 1_000_000 });
    const col = (
      db as unknown as { collection: (n: string) => { bulkWrite: ReturnType<typeof vi.fn> } }
    ).collection("infraProjects");
    const bucket = {
      national: {} as Record<string, number>,
      regional: {} as Record<string, Record<string, number>>,
    };
    await applyInfraEffects(db, "US", "secretary_of_transportation", bucket, 10);
    expect(col.bulkWrite).toHaveBeenCalled();
    const empty = {
      national: {} as Record<string, number>,
      regional: {} as Record<string, Record<string, number>>,
    };
    await applyInfraEffects(dbWith([finishing], { gdp: 1 }), "US", "secretary_of_state", empty, 10);
    expect(Object.keys(empty.regional)).toHaveLength(0);
  });
});
