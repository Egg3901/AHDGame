import { beforeEach, describe, expect, it } from "vitest";
import type { Db } from "mongodb";
import { createInMemoryDb } from "@/lib/test-utils/inMemoryDb";
import { clearOrgBuildSizeCache, resolveOrgBuildSizeMultiplier } from "./orgBuildStateSize";
import { ORG_BUILD_SIZE_MULTIPLIER_MAX, ORG_BUILD_SIZE_MULTIPLIER_MIN } from "./strengthConstants";

/**
 * Four US-ish regions whose sqrt-mean normalizer is a round number:
 * sqrt of 1M/4M/9M/16M = 1000/2000/3000/4000, mean 2500.
 */
function seed() {
  const db = createInMemoryDb();
  const rows = [
    { _id: "AK", countryId: "US", population: 1_000_000 },
    { _id: "KS", countryId: "US", population: 4_000_000 },
    { _id: "IL", countryId: "US", population: 9_000_000 },
    { _id: "NY", countryId: "US", population: 16_000_000 },
    // Another country must not influence the US normalizer.
    { _id: "LON", countryId: "UK", population: 100_000_000 },
  ];
  for (const r of rows) db.collection("states").insertOne(r);
  return db;
}

describe("resolveOrgBuildSizeMultiplier", () => {
  let db: ReturnType<typeof createInMemoryDb>;

  beforeEach(() => {
    clearOrgBuildSizeCache();
    db = seed();
  });

  it("charges the largest state more than the smallest", async () => {
    const ny = await resolveOrgBuildSizeMultiplier(db as unknown as Db, "US", "NY");
    const ak = await resolveOrgBuildSizeMultiplier(db as unknown as Db, "US", "AK");

    expect(ny).toBeGreaterThan(1);
    expect(ak).toBeLessThan(1);
    // sqrt 4000/2500 = 1.6 ; sqrt 1000/2500 = 0.4, clamped up to the floor.
    expect(ny).toBeCloseTo(1.6, 6);
    expect(ak).toBe(ORG_BUILD_SIZE_MULTIPLIER_MIN);
  });

  it("averages to 1 across a country, so the change only redistributes", async () => {
    const ids = ["AK", "KS", "IL", "NY"];
    const raw = [1000 / 2500, 2000 / 2500, 3000 / 2500, 4000 / 2500];
    expect(raw.reduce((a, b) => a + b, 0) / raw.length).toBeCloseTo(1, 6);

    const resolved = await Promise.all(
      ids.map((id) => resolveOrgBuildSizeMultiplier(db as unknown as Db, "US", id))
    );
    // Only the floor clamp bends it away from exactly 1, and only at the tail.
    const mean = resolved.reduce((a, b) => a + b, 0) / resolved.length;
    expect(mean).toBeGreaterThan(0.9);
    expect(mean).toBeLessThan(1.2);
  });

  it("normalizes per country, ignoring other countries' regions", async () => {
    // UK's single 100M region must not drag the US normalizer.
    const ks = await resolveOrgBuildSizeMultiplier(db as unknown as Db, "US", "KS");
    expect(ks).toBeCloseTo(2000 / 2500, 6);
  });

  it("prices a single-region country neutrally", async () => {
    const uk = await resolveOrgBuildSizeMultiplier(db as unknown as Db, "UK", "LON");
    expect(uk).toBe(1);
  });

  it("returns a neutral 1 for a state with no population data", async () => {
    await db.collection("states").insertOne({ _id: "ZZ", countryId: "US", population: 0 });
    expect(await resolveOrgBuildSizeMultiplier(db as unknown as Db, "US", "ZZ")).toBe(1);
  });

  it("returns a neutral 1 when the state row is missing", async () => {
    expect(await resolveOrgBuildSizeMultiplier(db as unknown as Db, "US", "NOPE")).toBe(1);
  });

  it("clamps a state that dwarfs its country", async () => {
    await db.collection("states").insertOne({ _id: "HUGE", countryId: "US", population: 9e12 });
    clearOrgBuildSizeCache();
    expect(await resolveOrgBuildSizeMultiplier(db as unknown as Db, "US", "HUGE")).toBe(
      ORG_BUILD_SIZE_MULTIPLIER_MAX
    );
  });

  it("caches the country aggregate rather than re-reading it every click", async () => {
    const first = await resolveOrgBuildSizeMultiplier(db as unknown as Db, "US", "NY");

    // Shift every population; a cached normalizer keeps the old answer.
    await db.collection("states").updateOne({ _id: "AK" }, { $set: { population: 16_000_000 } });
    const cached = await resolveOrgBuildSizeMultiplier(db as unknown as Db, "US", "NY");
    expect(cached).toBe(first);

    clearOrgBuildSizeCache();
    const fresh = await resolveOrgBuildSizeMultiplier(db as unknown as Db, "US", "NY");
    expect(fresh).toBeLessThan(first);
  });
});
