import { beforeEach, describe, expect, it } from "vitest";
import type { Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import { nuclearProgramBaselines, seedColdWarFoundations } from "./seedColdWarFoundations";

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
});
