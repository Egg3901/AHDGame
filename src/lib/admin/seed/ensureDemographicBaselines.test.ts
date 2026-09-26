import { describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { ensureDemographicBaselines } from "./ensureDemographicBaselines";

describe("ensureDemographicBaselines", () => {
  it("creates missing baselines and neutral turnout without replacing existing drift", async () => {
    const demographics = [
      {
        _id: "FR_IDF",
        countryId: "FR",
        categoryWeights: {},
        groups: {},
        lastUpdated: new Date("2027-01-01"),
      },
    ];
    const baselineWrite = vi.fn().mockResolvedValue({});
    const turnoutWrite = vi.fn().mockResolvedValue({});
    const db = {
      collection: (name: string) => {
        if (name === "stateDemographics")
          return { find: () => ({ toArray: async () => demographics }) };
        if (name === "demographicDefaults") return { bulkWrite: baselineWrite };
        if (name === "stateDemographicTurnout") return { bulkWrite: turnoutWrite };
        throw new Error(name);
      },
    } as unknown as Db;

    await ensureDemographicBaselines(db, vi.fn());

    expect(baselineWrite).toHaveBeenCalledWith([
      expect.objectContaining({
        updateOne: expect.objectContaining({
          filter: { _id: "FR_IDF" },
          update: {
            $setOnInsert: {
              countryId: "FR",
              categoryWeights: {},
              groups: {},
              lastUpdated: demographics[0]!.lastUpdated,
            },
          },
        }),
      }),
    ]);
    expect(turnoutWrite).toHaveBeenCalledWith([
      expect.objectContaining({
        updateOne: expect.objectContaining({
          filter: { _id: "FR_IDF" },
          update: {
            $set: { countryId: "FR" },
            $setOnInsert: {
              modifiers: {},
              lastDecayApplied: expect.any(Date),
              lastUpdated: expect.any(Date),
            },
          },
        }),
      }),
    ]);
  });
});
