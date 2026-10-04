import { describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { states1991 } from "@/lib/countries/us/data/usStates1991";
import { createMockDb } from "@/lib/test-utils/mockDb";
import { readResetMetricDetail } from "./readMetricDetail";
import { buildOpeningMetricSnapshots1991 } from "./seedOpening1991";

describe("v2 metric detail read", () => {
  it("returns aligned history and every regional owner for a region-owned metric", async () => {
    const db = createMockDb();
    const boards = buildOpeningMetricSnapshots1991("world-detail", 1);
    const national = boards.find((board) => board._id === "US:national")!;
    const regional = boards.filter(
      (board) => board.countryId === "US" && board.scope === "regional"
    );
    db.collection("resetMetricSnapshots").find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue(regional),
    });
    db.collection("states").find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue(states1991),
    });

    const result = await readResetMetricDetail(db as unknown as Db, national, "02");
    expect(result?.regions).toHaveLength(states1991.length);
    expect(result?.history).toHaveLength(1);
    expect(result?.history[0]?.value).toBe(result?.nationalValue);
    expect(result?.regions.some((region) => region.name === "Pennsylvania")).toBe(true);
  });

  it("returns the selected region's own history on a regional metric page", async () => {
    const db = createMockDb();
    const boards = buildOpeningMetricSnapshots1991("world-detail", 1);
    const regional = boards.filter(
      (board) => board.countryId === "US" && board.scope === "regional"
    );
    const pennsylvania = regional.find((board) => board.regionId === "PA")!;
    db.collection("resetMetricSnapshots").find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue(regional),
    });
    db.collection("states").find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue(states1991),
    });

    const result = await readResetMetricDetail(db as unknown as Db, pennsylvania, "02");

    expect(result?.history).toEqual(pennsylvania.history?.["02"]);
    expect(result?.history[0]?.value).toBe(pennsylvania.observations["02"]?.value);
    expect(result?.history[0]?.value).not.toBe(result?.nationalValue);
  });

  it("uses the national owner series for a national-only metric", async () => {
    const db = createMockDb();
    const national = buildOpeningMetricSnapshots1991("world-detail", 1).find(
      (board) => board._id === "US:national"
    )!;
    db.collection("resetMetricSnapshots").findOne.mockResolvedValue(national);
    const result = await readResetMetricDetail(db as unknown as Db, national, "07");
    expect(result).toEqual({
      history: [{ turn: 1, value: national.observations["07"]!.value }],
      nationalValue: national.observations["07"]!.value,
      regions: [],
    });
  });
});
