import { describe, it, expect, beforeEach } from "vitest";
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

  it("returns empty maps when absent", async () => {
    db.collectionMocks.politicalCabinetContribution.findOne.mockResolvedValue(null);
    expect(await getPoliticalCabinetContribution(db as unknown as Db, "US")).toEqual({
      contribution: {},
      regional: {},
      sources: {},
    });
  });

  it("returns the stored contribution", async () => {
    db.collectionMocks.politicalCabinetContribution.findOne.mockResolvedValue({
      _id: "US",
      countryId: "US",
      contribution: { "order.safety": 2 },
      regional: { CA: { "order.safety": 0.4 } },
      turn: 5,
    });
    expect(await getPoliticalCabinetContribution(db as unknown as Db, "US")).toEqual({
      contribution: { "order.safety": 2 },
      regional: { CA: { "order.safety": 0.4 } },
      sources: {},
    });
  });

  it("treats a pre-#1129 snapshot without regional as {}", async () => {
    db.collectionMocks.politicalCabinetContribution.findOne.mockResolvedValue({
      _id: "US",
      countryId: "US",
      contribution: { "order.safety": 2 },
      turn: 5,
    });
    expect(await getPoliticalCabinetContribution(db as unknown as Db, "US")).toEqual({
      contribution: { "order.safety": 2 },
      regional: {},
      sources: {},
    });
  });

  it("upserts a contribution snapshot including regional extras", async () => {
    await setPoliticalCabinetContribution(db as unknown as Db, "US", { "order.safety": 1 }, 5, {
      CA: { "order.safety": 0.4 },
    });
    expect(db.collectionMocks.politicalCabinetContribution.updateOne).toHaveBeenCalledWith(
      { _id: "US" },
      {
        $set: {
          countryId: "US",
          contribution: { "order.safety": 1 },
          regional: { CA: { "order.safety": 0.4 } },
          sources: {},
          turn: 5,
        },
      },
      { upsert: true }
    );
  });
});
