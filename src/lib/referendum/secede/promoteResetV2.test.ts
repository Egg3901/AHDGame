import { describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { createMockDb } from "@/lib/test-utils/mockDb";
import { promoteResetV2ForIndependence } from "./promoteResetV2";

describe("promoteResetV2ForIndependence", () => {
  it("promotes demographics independently when metrics remains v1", async () => {
    const db = createMockDb();
    db.collection("gameState").findOne.mockResolvedValue({
      _id: "current",
      currentTurn: 12,
      resetWorldId: "world-a",
      metricsSystemVersion: "v1",
      legislationSystemVersion: "v1",
      cabinetSystemVersion: "v1",
      demographicsSystemVersion: "v2",
      resetVersionSeeds: {
        demographics: {
          worldId: "world-a",
          revision: 1,
          sourceTurn: 1,
          completedAt: "2026-01-01T00:00:00.000Z",
          verificationHash: "uk-opening",
          countries: ["US", "UK", "JP"],
        },
      },
    });
    const statesCursor = {
      sort: vi.fn().mockReturnThis(),
      toArray: vi
        .fn()
        .mockResolvedValue([{ _id: "SCO-HIGHLANDS", countryId: "SCO", population: 1_000_000 }]),
    };
    db.collection("states").find.mockReturnValue(statesCursor);
    const ages = { male: Array(101).fill(1), female: Array(101).fill(1) };
    db.collection("regionDemographics").find.mockReturnValue({
      sort: vi.fn().mockReturnThis(),
      toArray: vi.fn().mockResolvedValue([
        {
          _id: "SCO-HIGHLANDS",
          countryId: "SCO",
          ages,
          lastUpdated: new Date("2026-01-01T00:00:00.000Z"),
        },
      ]),
    });

    await expect(promoteResetV2ForIndependence(db as unknown as Db, "SCO")).resolves.toEqual({
      promoted: true,
    });

    expect(db.collectionMocks.resetMetricSnapshots?.findOne).not.toHaveBeenCalled();
    expect(db.collectionMocks.gameState!.updateOne).toHaveBeenCalledWith(
      { _id: "current", resetWorldId: "world-a" },
      {
        $set: {
          "resetVersionSeeds.demographics": expect.objectContaining({
            worldId: "world-a",
            verificationHash: expect.stringMatching(/^[a-f0-9]{64}$/),
            countries: ["JP", "SCO", "UK", "US"],
          }),
        },
      }
    );
  });
});
