import { describe, expect, it } from "vitest";
import type { Db } from "mongodb";
import { states1991 } from "@/lib/countries/us/data/usStates1991";
import { createMockDb } from "@/lib/test-utils/mockDb";
import { buildOpeningMetricSnapshots1991 } from "./seedOpening1991";
import { readNationalMetricRollup } from "./readNationalRollup";

describe("national v2 metric rollup reader", () => {
  it("combines five sovereign observations with 53 validated regional rollups", async () => {
    const db = createMockDb();
    const boards = buildOpeningMetricSnapshots1991("world-test", 1);
    const national = boards.find((board) => board._id === "US:national")!;
    const regional = boards.filter(
      (board) => board.countryId === "US" && board.scope === "regional"
    );
    db.collection("resetMetricSnapshots").find.mockReturnValue({
      toArray: async () => regional,
    });
    db.collection("states").find.mockReturnValue({ toArray: async () => states1991 });

    const observations = await readNationalMetricRollup(db as unknown as Db, national);
    expect(Object.keys(observations ?? {})).toHaveLength(58);
    expect(observations?.["07"]).toEqual(national.observations["07"]);
    expect(observations?.["01"]?.source).toContain("national rollup");
  });

  it("fails closed when a regional board is missing", async () => {
    const db = createMockDb();
    const boards = buildOpeningMetricSnapshots1991("world-test", 1);
    const national = boards.find((board) => board._id === "US:national")!;
    const regional = boards.filter(
      (board) => board.countryId === "US" && board.scope === "regional"
    );
    db.collection("resetMetricSnapshots").find.mockReturnValue({
      toArray: async () => regional.slice(1),
    });
    db.collection("states").find.mockReturnValue({ toArray: async () => states1991 });
    expect(await readNationalMetricRollup(db as unknown as Db, national)).toBeNull();
  });
});
