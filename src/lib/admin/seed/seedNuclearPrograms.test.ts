import { describe, expect, it } from "vitest";
import type { Db } from "mongodb";
import { createMockDb } from "@/lib/test-utils/mockDb";
import {
  historicalAdoptedNodes,
  historicalWarheads,
  seedNuclearPrograms,
} from "./seedNuclearPrograms";

describe("historicalAdoptedNodes", () => {
  it("1945 gives the US fission only, and nothing to RU/UK", () => {
    expect(historicalAdoptedNodes("US", 1945)).toEqual({ "device-fission": 1 });
    expect(historicalAdoptedNodes("RU", 1945)).toEqual({});
    expect(historicalAdoptedNodes("UK", 1945)).toEqual({});
  });

  it("1959 matches the historical table", () => {
    expect(historicalAdoptedNodes("US", 1959)).toEqual({
      "device-fission": 1,
      "device-boosted": 1,
      "device-thermo": 1,
      "delivery-bombers": 1,
      "delivery-irbm": 1,
      "delivery-icbm": 1,
    });
    expect(historicalAdoptedNodes("RU", 1959)).toEqual({
      "device-fission": 1,
      "device-boosted": 1,
      "device-thermo": 1,
      "delivery-bombers": 1,
      "delivery-irbm": 1,
      "delivery-icbm": 1,
    });
    expect(historicalAdoptedNodes("UK", 1959)).toEqual({
      "device-fission": 1,
      "device-boosted": 1,
      "device-thermo": 1,
      "delivery-bombers": 1,
      "delivery-irbm": 1,
    });
  });

  it("UK never gets an ICBM; SLBM arrives 1968", () => {
    const uk1967 = historicalAdoptedNodes("UK", 1967);
    expect(uk1967["delivery-slbm"]).toBeUndefined();
    const uk1968 = historicalAdoptedNodes("UK", 1968);
    expect(uk1968["delivery-slbm"]).toBe(1);
    expect(uk1968["delivery-icbm"]).toBeUndefined();
  });
});

describe("historicalWarheads", () => {
  it("hits the anchor years exactly", () => {
    expect(historicalWarheads("US", 1945)).toBe(1);
    expect(historicalWarheads("US", 1953)).toBe(25);
    expect(historicalWarheads("RU", 1953)).toBe(8);
    expect(historicalWarheads("UK", 1953)).toBe(2);
    expect(historicalWarheads("US", 1959)).toBe(60);
    expect(historicalWarheads("RU", 1959)).toBe(30);
    expect(historicalWarheads("UK", 1959)).toBe(8);
    expect(historicalWarheads("US", 1968)).toBe(90);
    expect(historicalWarheads("RU", 1968)).toBe(70);
    expect(historicalWarheads("UK", 1968)).toBe(12);
  });

  it("interpolates linearly and floors at 0 before the programme", () => {
    // US 1949: halfway 1945->1953, 1 + (25-1)*0.5 = 13
    expect(historicalWarheads("US", 1949)).toBe(13);
    expect(historicalWarheads("RU", 1948)).toBe(0);
    expect(historicalWarheads("UK", 1951)).toBe(0);
    // Beyond the last anchor: clamp flat.
    expect(historicalWarheads("US", 1975)).toBe(90);
  });
});

describe("seedNuclearPrograms", () => {
  it("year 1945 seeds only the US, with fission and 1 warhead", async () => {
    const db = createMockDb();
    const result = await seedNuclearPrograms(db as unknown as Db, { year: 1945 });
    expect(result.seeded).toEqual(["US"]);
    const col = db.collectionMocks["nuclearPrograms"];
    expect(col.updateOne).toHaveBeenCalledTimes(1);
    const [filter, update, opts] = col.updateOne.mock.calls[0];
    expect(filter).toEqual({ _id: "US" });
    expect(opts).toEqual({ upsert: true });
    expect(update.$set.adopted).toEqual({ "device-fission": 1 });
    expect(update.$set.warheads).toBe(1);
    expect(update.$set.productionRate).toBe(0);
  });

  it("year 1959 seeds all three powers per the table", async () => {
    const db = createMockDb();
    const result = await seedNuclearPrograms(db as unknown as Db, { year: 1959 });
    expect(result.seeded).toEqual(["US", "RU", "UK"]);
    const col = db.collectionMocks["nuclearPrograms"];
    const byId = new Map(col.updateOne.mock.calls.map((c) => [c[0]._id, c[1].$set]));
    expect(byId.get("US").warheads).toBe(60);
    expect(byId.get("RU").warheads).toBe(30);
    expect(byId.get("UK").warheads).toBe(8);
    expect(byId.get("UK").adopted["delivery-icbm"]).toBeUndefined();
    expect(byId.get("RU").adopted["delivery-icbm"]).toBe(1);
  });

  it("skips a country whose doc already has adopted nodes (idempotent, never clobbers)", async () => {
    const db = createMockDb();
    // Touch the collection so the lazy mock exists, then simulate existing docs.
    const col = (db as unknown as Db).collection(
      "nuclearPrograms"
    ) as unknown as (typeof db.collectionMocks)[string];
    col.findOne.mockImplementation(async (filter: { _id: string }) =>
      filter._id === "US"
        ? { _id: "US", adopted: { "device-fission": 5 }, warheads: 3, productionRate: 2 }
        : null
    );
    const result = await seedNuclearPrograms(db as unknown as Db, { year: 1959 });
    expect(result.skipped).toEqual(["US"]);
    expect(result.seeded).toEqual(["RU", "UK"]);
    const written = col.updateOne.mock.calls.map((c) => c[0]._id);
    expect(written).toEqual(["RU", "UK"]);
  });
});
