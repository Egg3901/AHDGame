import { describe, expect, it, vi } from "vitest";
import {
  NPP_OPERATOR_TELEMETRY_COLLECTION,
  NPP_OPERATOR_TELEMETRY_RETENTION_TURNS,
  recordNppOperatorObservationsBestEffort,
} from "./persistence";
import { buildNppOperatorObservation } from "./rules";

function mockDb() {
  const updateOne = vi.fn().mockResolvedValue(undefined);
  const deleteMany = vi.fn().mockResolvedValue(undefined);
  const collection = vi.fn().mockReturnValue({ updateOne, deleteMany });
  return { db: { collection } as never, collection, updateOne, deleteMany };
}

describe("recordNppOperatorObservationsBestEffort", () => {
  it("writes one aggregate document for the cohort and bounds retention", async () => {
    const { db, collection, updateOne, deleteMany } = mockDb();
    const now = new Date("2026-09-20T00:00:00.000Z");
    await recordNppOperatorObservationsBestEffort(db, 100, now, [
      buildNppOperatorObservation({
        passive: false,
        profitable: true,
        marginPct: 20,
        cashCrisis: false,
        entryReason: "entered",
        dividendRate: 5,
        divestedSectors: 1,
        reinvestments: 2,
        cashHeadroomAnchor: 50,
      }),
    ]);

    expect(collection).toHaveBeenCalledWith(NPP_OPERATOR_TELEMETRY_COLLECTION);
    expect(updateOne).toHaveBeenCalledWith(
      { _id: "turn:100" },
      {
        $set: expect.objectContaining({
          schemaVersion: 1,
          turn: 100,
          generatedAt: now,
          corporationsObserved: 1,
          bindingGateCounts: { entered: 1 },
          divestedSectors: 1,
          reinvestments: 2,
        }),
      },
      { upsert: true }
    );
    expect(deleteMany).toHaveBeenCalledWith({
      turn: { $lt: 100 - NPP_OPERATOR_TELEMETRY_RETENTION_TURNS + 1 },
    });
  });

  it("does not touch Mongo for an empty cohort", async () => {
    const { db, updateOne, deleteMany } = mockDb();
    await recordNppOperatorObservationsBestEffort(db, 100, new Date(), []);
    expect(updateOne).not.toHaveBeenCalled();
    expect(deleteMany).not.toHaveBeenCalled();
  });
});
