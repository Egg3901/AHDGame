import { beforeEach, describe, expect, it } from "vitest";
import type { Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import { nuclearProgramBaselines, seedColdWarFoundations } from "./seedColdWarFoundations";
import type { LivingConflictState } from "@/lib/livingConflict/types";

describe("seedColdWarFoundations", () => {
  let db: MockDb;

  beforeEach(() => {
    db = createMockDb();
    for (const name of [
      "nuclearPrograms",
      "livingConflicts",
      "coldWarTension",
      "nationalDoctrine",
      "gameState",
      "crises",
    ]) {
      db.collection(name);
    }
    db.collectionMocks.nuclearPrograms!.find.mockReturnValue({ toArray: async () => [] } as never);
    db.collectionMocks.livingConflicts!.find.mockReturnValue({ toArray: async () => [] } as never);
    db.collectionMocks.coldWarTension!.findOne.mockResolvedValue(null);
    db.collectionMocks.nationalDoctrine!.find.mockReturnValue({ toArray: async () => [] } as never);
  });

  it("gives a 1959 world two credible superpower arsenals and a smaller UK programme", () => {
    const baselines = nuclearProgramBaselines(1959);
    expect(baselines.map((program) => program._id)).toEqual(["US", "RU", "UK"]);
    expect(baselines.find((program) => program._id === "US")?.adopted["delivery-icbm"]).toBe(1);
    expect(baselines.find((program) => program._id === "RU")?.warheads).toBeGreaterThan(0);
    expect(baselines.find((program) => program._id === "UK")?.warheads).toBeLessThan(
      baselines.find((program) => program._id === "US")!.warheads
    );
  });

  it("does not replace existing nuclear programme documents", async () => {
    db.collectionMocks.nuclearPrograms!.find.mockReturnValue({
      toArray: async () => [{ _id: "US", adopted: { "device-fission": 10 }, warheads: 99 }],
    } as never);
    db.collectionMocks.nuclearPrograms!.findOne.mockImplementation(async (filter) =>
      filter._id === "US"
        ? { _id: "US", adopted: { "device-fission": 10 }, warheads: 99, productionRate: 2 }
        : null
    );

    await seedColdWarFoundations(db as unknown as Db, 1959, 338);

    const written = db.collectionMocks.nuclearPrograms!.updateOne.mock.calls.map(
      (call) => call[0]._id
    );
    expect(written).toEqual(["RU", "UK"]);
  });

  it("writes nothing during migration preview", async () => {
    const result = await seedColdWarFoundations(db as unknown as Db, 1959, 338, {
      dryRun: true,
    });

    expect(result.programsInserted).toBe(3);
    expect(db.collectionMocks.nuclearPrograms!.updateOne).not.toHaveBeenCalled();
    expect(db.collectionMocks.gameState!.updateOne).not.toHaveBeenCalled();
  });

  it("persists authored 2027 opening states only for missing rows and preserves them on retry", async () => {
    const stored = new Map<string, LivingConflictState>();
    db.collectionMocks.nuclearPrograms!.find.mockReturnValue({
      toArray: async () => nuclearProgramBaselines(2027),
    } as never);
    db.collectionMocks.coldWarTension!.findOne.mockResolvedValue({ _id: "current" });
    db.collectionMocks.states = db.collection("states");
    db.collectionMocks.states!.find.mockReturnValue({
      toArray: async () => [
        { countryId: "IE", population: 5_000_000 },
        { countryId: "UKR", population: 30_000_000 },
      ],
    } as never);
    db.collectionMocks.macroCountries = db.collection("macroCountries");
    db.collectionMocks.macroCountries!.find.mockReturnValue({
      toArray: async () => [
        { entityId: "YE", population: 30_000_000 },
        { entityId: "SY", population: 20_000_000 },
        { entityId: "LY", population: 7_000_000 },
        { entityId: "TN", population: 12_000_000 },
        { entityId: "EG", population: 100_000_000 },
        { entityId: "TR", population: 80_000_000 },
      ],
    } as never);
    db.collectionMocks.livingConflicts!.find.mockImplementation(() => ({
      toArray: async () => [...stored.values()],
    }));
    db.collectionMocks.livingConflicts!.bulkWrite.mockImplementation(async (operations) => {
      for (const operation of operations) {
        const key = operation.updateOne.filter.defKey;
        if (!stored.has(key) && operation.updateOne.update.$setOnInsert)
          stored.set(key, operation.updateOne.update.$setOnInsert);
      }
    });

    await seedColdWarFoundations(db as unknown as Db, 2027, 1248, { presetId: "2027-default" });
    expect(stored.get("northern_ireland")).toMatchObject({ phaseLevel: 6, status: "settled" });
    expect(stored.get("global_financial_crisis")).toMatchObject({
      phaseLevel: 7,
      status: "closed",
    });
    expect(stored.get("yugoslav_dissolution")).toMatchObject({
      status: "closed",
      openingDisposition: "not_applicable",
    });
    expect(stored.get("arab_uprisings")?.arabRegional?.origins.YE?.population).toBe(30_000_000);
    const prior = structuredClone(stored.get("northern_ireland"));
    const writes = db.collectionMocks.livingConflicts!.bulkWrite.mock.calls.length;
    await seedColdWarFoundations(db as unknown as Db, 2027, 1248, { presetId: "2027-default" });
    expect(db.collectionMocks.livingConflicts!.bulkWrite.mock.calls.length).toBe(writes);
    expect(stored.get("northern_ireland")).toEqual(prior);
  });
});
