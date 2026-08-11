import { describe, it, expect, vi } from "vitest";
import { type Db } from "mongodb";
import { createMockDb } from "@/lib/test-utils/mockDb";
import { getRegionOwnership, regionCodesOfCountry } from "./regionOwnership";

function cursorOf(docs: unknown[]) {
  const c = { project: vi.fn(() => c), toArray: vi.fn().mockResolvedValue(docs) };
  return c;
}

describe("getRegionOwnership", () => {
  it("maps each region code to its live owning countryId", async () => {
    const db = createMockDb();
    db.collection("states").find.mockReturnValue(
      cursorOf([
        { _id: "NIR", countryId: "IE" },
        { _id: "LON", countryId: "UK" },
        { _id: "DUB", countryId: "IE" },
      ])
    );
    db.collection("states").distinct.mockResolvedValue([]);
    const own = await getRegionOwnership(db as unknown as Db, ["NIR", "LON", "DUB"]);
    expect(own).toEqual({ NIR: "IE", LON: "UK", DUB: "IE" });
  });

  it("omits codes with no states doc, and short-circuits an empty request", async () => {
    const db = createMockDb();
    db.collection("states").find.mockReturnValue(cursorOf([{ _id: "LON", countryId: "UK" }]));
    db.collection("states").distinct.mockResolvedValue([]);
    expect(await getRegionOwnership(db as unknown as Db, ["LON", "ZZZ"])).toEqual({ LON: "UK" });
    expect(await getRegionOwnership(db as unknown as Db, [])).toEqual({});
  });

  it("resolves a coarse region that seceded into its own nation to itself", async () => {
    // No `states` doc for "SCO" (it expanded into sub-regions on secession), but
    // sub-region states carry countryId "SCO" → the coarse map region owns itself,
    // so the world map's British-Isles blob renders instead of vanishing.
    const db = createMockDb();
    db.collection("states").find.mockReturnValue(cursorOf([{ _id: "LON", countryId: "UK" }]));
    db.collection("states").distinct.mockResolvedValue(["SCO"]);
    const own = await getRegionOwnership(db as unknown as Db, ["LON", "SCO"]);
    expect(own).toEqual({ LON: "UK", SCO: "SCO" });
  });
});

describe("regionCodesOfCountry", () => {
  it("returns the country's region codes that the map manifest can draw", async () => {
    const db = createMockDb();
    // CA and TX are US shard codes; "NOPE" is in no shard.
    db.collection("states").find.mockReturnValue(
      cursorOf([{ _id: "CA" }, { _id: "TX" }, { _id: "NOPE" }])
    );

    const out = await regionCodesOfCountry(db as unknown as Db, "US");

    expect(out).toContain("CA");
    expect(out).toContain("TX");
    expect(out).not.toContain("NOPE");
  });

  it("returns nothing for a country with no states", async () => {
    const db = createMockDb();
    db.collection("states").find.mockReturnValue(cursorOf([]));
    expect(await regionCodesOfCountry(db as unknown as Db, "US")).toEqual([]);
  });

  it("scopes the query to the country", async () => {
    const db = createMockDb();
    db.collection("states").find.mockReturnValue(cursorOf([{ _id: "CA" }]));
    await regionCodesOfCountry(db as unknown as Db, "US");
    expect(db.collectionMocks.states.find).toHaveBeenCalledWith({ countryId: "US" });
  });
});
