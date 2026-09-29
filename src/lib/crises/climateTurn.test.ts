import { describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { createMockDb } from "@/lib/test-utils/mockDb";
import { processClimateFeedbackTurn, type ClimateFeedbackState } from "./climateTurn";

describe("global climate feedback turn", () => {
  it("samples region emissions once per year and does not count a replay twice", async () => {
    const db = createMockDb();
    let stored: ClimateFeedbackState | null = null;
    db.collection("climateFeedbackState").findOne.mockImplementation(async () => stored);
    db.collection("climateFeedbackState").updateOne.mockImplementation(
      async (_filter: unknown, update: { $set: Omit<ClimateFeedbackState, "_id"> }) => {
        stored = { _id: "world", ...update.$set };
      }
    );
    db.collection("states").find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([
        { _id: "A", population: 10 },
        { _id: "B", population: 30 },
        { _id: "federal", population: 40 },
      ]),
    });
    db.collection("stateMetrics").find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([
        { _id: "A", environment: { carbonEmissions: { value: 2 } } },
        { _id: "B", environment: { carbonEmissions: { value: 10 } } },
        { _id: "federal", environment: { carbonEmissions: { value: 60 } } },
      ]),
    });

    expect(await processClimateFeedbackTurn(db as unknown as Db, 47)).toBe(0);
    expect(await processClimateFeedbackTurn(db as unknown as Db, 48)).toBeCloseTo(0.024);
    expect((stored as { globalTonsPerCapita: number } | null)?.globalTonsPerCapita).toBe(8);
    expect(await processClimateFeedbackTurn(db as unknown as Db, 48)).toBeCloseTo(0.024);
    expect(db.collectionMocks.climateFeedbackState!.updateOne).toHaveBeenCalledTimes(1);
    expect(await processClimateFeedbackTurn(db as unknown as Db, 96)).toBeCloseTo(0.048);
  });

  it("preserves old saves when no comparable carbon observations exist", async () => {
    const db = createMockDb();
    db.collection("climateFeedbackState").findOne.mockResolvedValue({
      _id: "world",
      pressure: 0.1,
      globalTonsPerCapita: 8,
      lastMeasuredTurn: 48,
    });
    expect(await processClimateFeedbackTurn(db as unknown as Db, 96)).toBe(0.1);
    expect(db.collectionMocks.climateFeedbackState!.updateOne).not.toHaveBeenCalled();
  });
});
