import { describe, it, expect } from "vitest";
import type { Db } from "mongodb";
import { createMockDb } from "@/lib/test-utils/mockDb";
import { getNationalDoctrine } from "./nationalDoctrine";
import { DEFAULT_ADOPTED, DEFAULT_POINTS } from "@/lib/military/doctrineTree";

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
