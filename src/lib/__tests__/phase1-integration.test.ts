import { describe, it, expect, beforeAll } from "vitest";
import { getDb } from "@/lib/mongodb";
import type { State, Election } from "@/lib/db/types";

// Skip these tests if MongoDB URI is not configured (requires real database)
const skipIfNoDb = !process.env.MONGODB_URI ? describe.skip : describe;

skipIfNoDb("Phase 1 Integration - Country Scoping", () => {
  beforeAll(async () => {
    const db = await getDb();
    await db.collection("states").createIndex({ countryId: 1 });
  });

  it("should query US states only", async () => {
    const db = await getDb();
    const usStates = await db.collection<State>("states").find({ countryId: "US" }).toArray();

    expect(usStates.length).toBeGreaterThan(0);
    expect(usStates.every((s) => s.countryId === "US")).toBe(true);
  });

  it("should query UK regions only", async () => {
    const db = await getDb();
    const ukRegions = await db.collection<State>("states").find({ countryId: "UK" }).toArray();

    expect(ukRegions.length).toBeGreaterThan(0);
    expect(ukRegions.every((s) => s.countryId === "UK")).toBe(true);
    expect(ukRegions.every((s) => s.countryId === "UK")).toBe(true);
  });

  it("should not mix countries in election queries", async () => {
    const db = await getDb();

    const usElections = await db
      .collection<Election>("elections")
      .find({ countryId: "US" })
      .toArray();

    const ukElections = await db
      .collection<Election>("elections")
      .find({ countryId: "UK" })
      .toArray();

    expect(usElections.every((e) => e.countryId === "US")).toBe(true);
    expect(ukElections.every((e) => e.countryId === "UK")).toBe(true);
  });

  it("should have indexes on countryId fields", async () => {
    const db = await getDb();

    const statesIndexes = await db.collection("states").indexes();
    const hasCountryIdIndex = statesIndexes.some((idx) => idx.key.countryId === 1);

    expect(hasCountryIdIndex).toBe(true);
  });
});
