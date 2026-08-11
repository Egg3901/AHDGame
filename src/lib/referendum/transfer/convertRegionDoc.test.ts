import { beforeEach, describe, expect, it, vi } from "vitest";
import { type Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import { convertRegionDoc, populationShareSeats } from "./convertRegionDoc";

function cursorOf<T>(docs: T[]) {
  const c = {
    sort: vi.fn(() => c),
    limit: vi.fn(() => c),
    project: vi.fn(() => c),
    toArray: vi.fn().mockResolvedValue(docs),
  };
  return c;
}

describe("populationShareSeats", () => {
  it("allocates seats at the peers' average people-per-seat ratio", () => {
    // Peers total 4.74M across 160 seats → ~29.6k/seat. NI 1.92M → ~65.
    const peers = [{ population: 4_740_000, seats: 160 }];
    expect(populationShareSeats(1_920_000, peers)).toBe(65);
  });
  it("floors at one seat", () => {
    expect(populationShareSeats(1000, [{ population: 5_000_000, seats: 160 }])).toBe(1);
  });
  it("returns 1 when peers have no population or seats", () => {
    expect(populationShareSeats(1_000_000, [])).toBe(1);
    expect(populationShareSeats(1_000_000, [{ population: 0, seats: 0 }])).toBe(1);
  });
});

describe("convertRegionDoc", () => {
  let db: MockDb;
  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
  });

  it("converts NIR to an Irish region with population-share seats + the new display name", async () => {
    db.collection("states").findOne.mockResolvedValue({ _id: "NIR", population: 1_920_000 });
    db.collection("states").find.mockReturnValue(
      cursorOf([{ _id: "DUB", population: 4_740_000, houseDistricts: 160, stateSenateSeats: 60 }])
    );

    await convertRegionDoc(db as unknown as Db, {
      regionId: "NIR",
      toCountryId: "IE",
      province: "Ulster",
      displayName: "Ulster",
    });

    const update = db.collectionMocks["states"].updateOne.mock.calls[0];
    expect(update[0]).toEqual({ _id: "NIR" });
    expect(update[1].$set.countryId).toBe("IE");
    expect(update[1].$set.regionType).toBe("region");
    expect(update[1].$set.region).toBe("Ulster");
    expect(update[1].$set.name).toBe("Ulster"); // "Northern Ireland" → "Ulster" in Ireland
    expect(update[1].$set.votingSystem).toBe("rcv");
    expect(update[1].$set.houseDistricts).toBe(65);
    expect(update[1].$set.stateSenateSeats).toBe(24); // 60/4.74M * 1.92M ≈ 24
    expect(update[1].$unset.parentRegionId).toBe("");
  });

  it("leaves the region name unchanged when no displayName is given", async () => {
    db.collection("states").findOne.mockResolvedValue({ _id: "NIR", population: 1_920_000 });
    db.collection("states").find.mockReturnValue(
      cursorOf([{ _id: "DUB", population: 4_740_000, houseDistricts: 160, stateSenateSeats: 60 }])
    );
    await convertRegionDoc(db as unknown as Db, {
      regionId: "NIR",
      toCountryId: "IE",
      province: "Ulster",
    });
    const update = db.collectionMocks["states"].updateOne.mock.calls[0];
    expect(update[1].$set.name).toBeUndefined();
  });
});
