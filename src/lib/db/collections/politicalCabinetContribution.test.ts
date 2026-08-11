import { describe, it, expect, beforeEach, vi } from "vitest";
import type { Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import {
  getPoliticalCabinetContribution,
  setPoliticalCabinetContribution,
} from "./politicalCabinetContribution";

describe("politicalCabinetContribution", () => {
  let db: MockDb;
  beforeEach(() => {
    db = createMockDb();
    db.collection("politicalCabinetContribution");
  });

  it("returns {} when absent", async () => {
    db.collectionMocks.politicalCabinetContribution.findOne.mockResolvedValue(null);
    expect(await getPoliticalCabinetContribution(db as unknown as Db, "US")).toEqual({});
  });

  it("returns the stored contribution", async () => {
    db.collectionMocks.politicalCabinetContribution.findOne.mockResolvedValue({
      _id: "US",
      countryId: "US",
      contribution: { "order.safety": 2 },
      turn: 5,
    });
    expect(await getPoliticalCabinetContribution(db as unknown as Db, "US")).toEqual({
      "order.safety": 2,
    });
  });

  it("upserts a contribution snapshot", async () => {
    await setPoliticalCabinetContribution(db as unknown as Db, "US", { "order.safety": 1 }, 5);
    expect(db.collectionMocks.politicalCabinetContribution.updateOne).toHaveBeenCalledWith(
      { _id: "US" },
      { $set: { countryId: "US", contribution: { "order.safety": 1 }, turn: 5 } },
      { upsert: true }
    );
  });
});
