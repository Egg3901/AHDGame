import { describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { createMockDb } from "@/lib/test-utils/mockDb";
import { verifyDemographicsV2Opening } from "./verifyOpening";

const vector = (value: number) => Array<number>(101).fill(value);

describe("verifyDemographicsV2Opening", () => {
  it("certifies complete, valid live vectors", async () => {
    const db = createMockDb();
    db.collection("states").find.mockReturnValue({
      sort: vi.fn().mockReturnThis(),
      toArray: vi.fn().mockResolvedValue([
        { _id: "CA", countryId: "US" },
        { _id: "TX", countryId: "US" },
      ]),
    });
    db.collection("regionDemographics").find.mockReturnValue({
      sort: vi.fn().mockReturnThis(),
      toArray: vi.fn().mockResolvedValue([
        {
          _id: "CA",
          countryId: "US",
          ages: { male: vector(1), female: vector(1) },
          lastUpdated: new Date("2026-01-01T00:00:00.000Z"),
        },
        {
          _id: "TX",
          countryId: "US",
          ages: { male: vector(2), female: vector(2) },
          lastUpdated: new Date("2026-01-01T00:00:00.000Z"),
        },
      ]),
    });

    const receipt = await verifyDemographicsV2Opening(db as unknown as Db, "world-a", 1, ["US"]);

    expect(receipt.countries).toEqual(["US"]);
    expect(receipt.verificationHash).toMatch(/^[a-f0-9]{64}$/);
    expect(db.collectionMocks.states!.find).toHaveBeenCalledWith(
      { countryId: { $in: ["US"] }, population: { $gt: 0 } },
      { projection: { _id: 1, countryId: 1 } }
    );
  });

  it("fails closed when any populated region lacks a live vector", async () => {
    const db = createMockDb();
    db.collection("states").find.mockReturnValue({
      sort: vi.fn().mockReturnThis(),
      toArray: vi.fn().mockResolvedValue([
        { _id: "CA", countryId: "US" },
        { _id: "TX", countryId: "US" },
      ]),
    });
    db.collection("regionDemographics").find.mockReturnValue({
      sort: vi.fn().mockReturnThis(),
      toArray: vi.fn().mockResolvedValue([
        {
          _id: "CA",
          countryId: "US",
          ages: { male: vector(1), female: vector(1) },
          lastUpdated: new Date("2026-01-01T00:00:00.000Z"),
        },
      ]),
    });

    await expect(
      verifyDemographicsV2Opening(db as unknown as Db, "world-a", 1, ["US"])
    ).rejects.toThrow("missing live population vectors for: TX");
  });

  it("fails closed on an invalid vector timestamp", async () => {
    const db = createMockDb();
    db.collection("states").find.mockReturnValue({
      sort: vi.fn().mockReturnThis(),
      toArray: vi.fn().mockResolvedValue([{ _id: "CA", countryId: "US" }]),
    });
    db.collection("regionDemographics").find.mockReturnValue({
      sort: vi.fn().mockReturnThis(),
      toArray: vi.fn().mockResolvedValue([
        {
          _id: "CA",
          countryId: "US",
          ages: { male: vector(1), female: vector(1) },
        },
      ]),
    });

    await expect(
      verifyDemographicsV2Opening(db as unknown as Db, "world-a", 1, ["US"])
    ).rejects.toThrow("no valid update time for CA");
  });
});
