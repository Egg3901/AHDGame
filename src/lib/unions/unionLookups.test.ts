import { describe, expect, it } from "vitest";
import { ObjectId, type Db } from "mongodb";
import type { Union } from "@/lib/db/types";
import { buildUnionEffectsById } from "./unionLookups";
import { loadLabourRelationsPoliticalNudgesByCountry } from "./labourRelationsPoliticalProvider";

function world(overrides: Partial<Union> = {}, workers = 100) {
  const union = {
    _id: new ObjectId(),
    countryId: "US",
    ownerId: new ObjectId(),
    approval: 75,
    treasury: 1000,
    duesPerWorkerAnnual: 0,
    activeServices: ["healthFund"],
    ...overrides,
  };
  const db = {
    collection: (name: string) => {
      if (name === "gameConfig") return { findOne: async () => ({ labourSystemMode: "full" }) };
      const rows =
        name === "unions"
          ? [union]
          : name === "corporateSectors"
            ? [
                {
                  representingUnionId: union._id,
                  workers,
                  unionization: 100,
                  wagePerWorker: 100,
                },
              ]
            : [];
      return { find: () => ({ toArray: async () => rows }) };
    },
  } as unknown as Db;
  return { union, db };
}

describe("union service effects match funded operations", () => {
  it.each([
    ["unfunded", { treasury: 0 }],
    ["vacant", { ownerId: null }],
    ["suspended", { suspended: true }],
  ] as const)(
    "a %s union keeps approval but supplies no service effects",
    async (_label, overrides) => {
      const { union, db } = world(overrides);
      const effects = await buildUnionEffectsById(db);
      expect(effects.get(union._id.toString())).toEqual({ approval: 75, activeServices: [] });
      const politics = await loadLabourRelationsPoliticalNudgesByCountry(db, 100);
      expect(politics.get("US")?.get("economy.workerSecurity") ?? 0).toBe(0);
    }
  );

  it("a union with no members supplies no service effects", async () => {
    const { union, db } = world({}, 0);
    expect((await buildUnionEffectsById(db)).get(union._id.toString())?.activeServices).toEqual([]);
    expect((await loadLabourRelationsPoliticalNudgesByCountry(db, 100)).size).toBe(0);
  });

  it("funded services still soften strikes and improve worker security", async () => {
    const { union, db } = world();
    expect((await buildUnionEffectsById(db)).get(union._id.toString())?.activeServices).toEqual([
      "healthFund",
    ]);
    expect(
      (await loadLabourRelationsPoliticalNudgesByCountry(db, 100))
        .get("US")
        ?.get("economy.workerSecurity")
    ).toBe(1.2);
  });

  it("includes this turn's dues when deciding whether services are funded", async () => {
    const { union, db } = world({ treasury: 0, duesPerWorkerAnnual: 10 });
    expect((await buildUnionEffectsById(db)).get(union._id.toString())?.activeServices).toEqual([
      "healthFund",
    ]);
  });
});
