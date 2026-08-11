import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import {
  designateStrategicSector,
  getDesignatedSectorTypes,
  corpHasStrategicSector,
} from "./strategicSectors";

function cursor<T>(rows: T[]) {
  return {
    toArray: vi.fn().mockResolvedValue(rows),
    sort: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    skip: vi.fn().mockReturnThis(),
    project: vi.fn().mockReturnThis(),
  };
}

describe("strategic-sector designations", () => {
  let db: MockDb;
  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
    db.collection("strategicSectorDesignations");
  });

  it("designate upserts one doc per (country, sectorType)", async () => {
    await designateStrategicSector(db as unknown as Db, {
      countryId: "US",
      sectorType: "energy",
      turn: 5,
      source: "executive",
    });
    const call = db.collectionMocks.strategicSectorDesignations.updateOne.mock.calls[0];
    expect(call[0]).toEqual({ countryId: "US", sectorType: "energy" });
    expect(call[2]).toEqual({ upsert: true });
  });

  it("getDesignatedSectorTypes returns the set for a country", async () => {
    db.collectionMocks.strategicSectorDesignations.find.mockReturnValue(
      cursor([
        { countryId: "US", sectorType: "energy" },
        { countryId: "US", sectorType: "defense" },
      ])
    );
    const set = await getDesignatedSectorTypes(db as unknown as Db, "US");
    expect(set.has("energy")).toBe(true);
    expect(set.has("defense")).toBe(true);
    expect(set.has("retail")).toBe(false);
  });

  it("corpHasStrategicSector matches a corp sector of a designated type in-country", () => {
    const designated = new Set(["energy"] as const);
    expect(
      corpHasStrategicSector(designated, "US", [
        { countryId: "US", sectorType: "energy" },
        { countryId: "US", sectorType: "retail" },
      ])
    ).toBe(true);
    expect(
      corpHasStrategicSector(designated, "US", [{ countryId: "US", sectorType: "retail" }])
    ).toBe(false);
    // A designated type operating in a DIFFERENT country does not match.
    expect(
      corpHasStrategicSector(designated, "US", [{ countryId: "UK", sectorType: "energy" }])
    ).toBe(false);
  });
});
