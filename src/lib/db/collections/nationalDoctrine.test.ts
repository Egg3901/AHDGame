import { describe, it, expect } from "vitest";
import type { Db } from "mongodb";
import { createMockDb } from "@/lib/test-utils/mockDb";
import { getNationalDoctrine, settleDoctrineIncome } from "./nationalDoctrine";
import { DEFAULT_ADOPTED, DEFAULT_POINTS } from "@/lib/military/doctrineTree";
import { DOCTRINE_POINTS_PER_YEAR } from "@/lib/military/doctrineIncome";

describe("getNationalDoctrine", () => {
  it("returns design defaults when the country has no doctrine doc", async () => {
    const db = createMockDb();
    db.collection("nationalDoctrine");
    db.collectionMocks.nationalDoctrine.findOne.mockResolvedValue(null);
    const d = await getNationalDoctrine(db as unknown as Db, "US");
    expect(d.points).toBe(DEFAULT_POINTS);
    expect(d.adopted).toEqual(DEFAULT_ADOPTED);
  });

  it("returns the stored adopted set + points when present", async () => {
    const db = createMockDb();
    db.collection("nationalDoctrine");
    db.collectionMocks.nationalDoctrine.findOne.mockResolvedValue({
      countryId: "US",
      adopted: { "army-4": 1 },
      points: 9,
    });
    const d = await getNationalDoctrine(db as unknown as Db, "US");
    expect(d.adopted).toEqual({ "army-4": 1 });
    expect(d.points).toBe(9);
  });
});

describe("settleDoctrineIncome", () => {
  it("creates the doctrine doc with starting points when the calendar has not advanced", async () => {
    const db = createMockDb();
    db.collection("nationalDoctrine");
    db.collectionMocks.nationalDoctrine.findOne.mockResolvedValue(null);
    const d = await settleDoctrineIncome(db as unknown as Db, "RU", 1953, 1953);
    expect(d.points).toBe(DEFAULT_POINTS);
    expect(db.collectionMocks.nationalDoctrine.insertOne).not.toHaveBeenCalled();
  });

  it("books catch-up income onto a new doc after a year has elapsed", async () => {
    const db = createMockDb();
    db.collection("nationalDoctrine");
    db.collectionMocks.nationalDoctrine.findOne.mockResolvedValue(null);
    const d = await settleDoctrineIncome(db as unknown as Db, "RU", 1953, 1954);
    expect(d.points).toBe(DEFAULT_POINTS + DOCTRINE_POINTS_PER_YEAR);
    expect(d.adopted).toEqual(DEFAULT_ADOPTED);
    expect(db.collectionMocks.nationalDoctrine.insertOne).toHaveBeenCalledWith(
      expect.objectContaining({
        countryId: "RU",
        points: DEFAULT_POINTS + DOCTRINE_POINTS_PER_YEAR,
        incomeThroughYear: 1954,
      })
    );
  });

  it("increments remaining points on an existing doc without resetting spent points", async () => {
    const db = createMockDb();
    db.collection("nationalDoctrine");
    db.collectionMocks.nationalDoctrine.findOne.mockResolvedValue({
      countryId: "RU",
      adopted: { "army-4": 1 },
      points: 5,
      incomeThroughYear: 1953,
    });
    db.collectionMocks.nationalDoctrine.updateOne.mockResolvedValue({
      matchedCount: 1,
      modifiedCount: 1,
    });
    const d = await settleDoctrineIncome(db as unknown as Db, "RU", 1953, 1954);
    expect(d.points).toBe(5 + DOCTRINE_POINTS_PER_YEAR);
    expect(d.adopted).toEqual({ "army-4": 1 });
    expect(db.collectionMocks.nationalDoctrine.updateOne).toHaveBeenCalledWith(
      { countryId: "RU", incomeThroughYear: 1953 },
      { $inc: { points: DOCTRINE_POINTS_PER_YEAR }, $set: { incomeThroughYear: 1954 } }
    );
  });

  it("does not write when this year's income is already booked", async () => {
    const db = createMockDb();
    db.collection("nationalDoctrine");
    db.collectionMocks.nationalDoctrine.findOne.mockResolvedValue({
      countryId: "RU",
      adopted: DEFAULT_ADOPTED,
      points: 13,
      incomeThroughYear: 1954,
    });
    const d = await settleDoctrineIncome(db as unknown as Db, "RU", 1953, 1954);
    expect(d.points).toBe(13);
    expect(db.collectionMocks.nationalDoctrine.updateOne).not.toHaveBeenCalled();
    expect(db.collectionMocks.nationalDoctrine.insertOne).not.toHaveBeenCalled();
  });
});
