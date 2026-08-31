import { describe, it, expect, vi, beforeEach } from "vitest";
import { type Db, ObjectId } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import { apportionOfficialsToChamber, rescaleRegionDelegations } from "./apportionChamber";

function cursorOf<T>(docs: T[]) {
  const c = {
    sort: vi.fn(() => c),
    limit: vi.fn(() => c),
    project: vi.fn(() => c),
    toArray: vi.fn().mockResolvedValue(docs),
  };
  return c;
}

const A = new ObjectId();
const B = new ObjectId();

describe("apportionOfficialsToChamber", () => {
  let db: MockDb;
  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
    db.collection("electedOfficials").updateOne.mockResolvedValue({ modifiedCount: 1 });
  });

  it("sizes the Bundestag delegation from houseDistricts, not from the seats doc", async () => {
    // Saxony: 151 Volkskammer seats landing in a 55-seat Bundestag delegation.
    // The `DE-bundestag-SN` document says 16, but that is the WAHLKREIS count and
    // sizing from it would more than halve the delegation.
    db.collection("states").findOne.mockResolvedValue({
      _id: "SN",
      houseDistricts: 55,
      stateSenateSeats: 160,
    });
    db.collection("seats").findOne.mockResolvedValue({ totalSeats: 16 });
    const seated = await apportionOfficialsToChamber(db as unknown as Db, {
      regionId: "SN",
      officeType: "bundestag",
      officials: [
        { _id: A, party: "7", seatsHeld: 83 },
        { _id: B, party: "9", seatsHeld: 68 },
      ],
      now: new Date(),
    });
    const total = db.collectionMocks["electedOfficials"].updateOne.mock.calls.reduce(
      (sum, c) => sum + c[1].$set.seatsHeld,
      0
    );
    expect(total).toBe(55);
    expect(seated).toBe(2);
  });

  it("sizes a Landtag delegation from stateSenateSeats", async () => {
    db.collection("states").findOne.mockResolvedValue({
      _id: "SN",
      houseDistricts: 55,
      stateSenateSeats: 120,
    });
    await apportionOfficialsToChamber(db as unknown as Db, {
      regionId: "SN",
      officeType: "landtag",
      officials: [{ _id: A, party: "7", seatsHeld: 17 }],
      now: new Date(),
    });
    expect(db.collectionMocks["electedOfficials"].updateOne.mock.calls[0][1].$set.seatsHeld).toBe(
      120
    );
  });

  it("leaves an executive office's counts alone", async () => {
    db.collection("states").findOne.mockResolvedValue({ _id: "SN", houseDistricts: 55 });
    await apportionOfficialsToChamber(db as unknown as Db, {
      regionId: "SN",
      officeType: "ministerPresident",
      officials: [{ _id: A, party: "7", seatsHeld: 0 }],
      extraSet: { countryId: "DE" },
      now: new Date(),
    });
    const set = db.collectionMocks["electedOfficials"].updateOne.mock.calls[0][1].$set;
    expect(set.seatsHeld).toBeUndefined();
    expect(set.countryId).toBe("DE");
  });

  it("leaves counts alone when the region has no size recorded", async () => {
    db.collection("states").findOne.mockResolvedValue({ _id: "SN" });
    await apportionOfficialsToChamber(db as unknown as Db, {
      regionId: "SN",
      officeType: "bundestag",
      officials: [{ _id: A, party: "7", seatsHeld: 83 }],
      now: new Date(),
    });
    expect(
      db.collectionMocks["electedOfficials"].updateOne.mock.calls[0][1].$set.seatsHeld
    ).toBeUndefined();
  });
});

describe("rescaleRegionDelegations", () => {
  let db: MockDb;
  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
    db.collection("electedOfficials").updateOne.mockResolvedValue({ modifiedCount: 1 });
    db.collection("states").findOne.mockResolvedValue({
      _id: "SN",
      houseDistricts: 55,
      stateSenateSeats: 120,
    });
  });

  it("rescales each chamber in the region separately", async () => {
    db.collection("electedOfficials").find.mockReturnValue(
      cursorOf([
        { _id: A, officeType: "bundestag", party: "7", seatsHeld: 83 },
        { _id: B, officeType: "landtag", party: "7", seatsHeld: 17 },
      ])
    );
    const n = await rescaleRegionDelegations(db as unknown as Db, {
      regionId: "SN",
      countryId: "DE",
    });
    expect(n).toBe(2);
    const seats = db.collectionMocks["electedOfficials"].updateOne.mock.calls.map(
      (c) => c[1].$set.seatsHeld
    );
    // One chamber of 55 and one of 120, not both onto the same number.
    expect(seats.sort((x, y) => x - y)).toEqual([55, 120]);
  });

  it("is a no-op for a region with no officials", async () => {
    db.collection("electedOfficials").find.mockReturnValue(cursorOf([]));
    const n = await rescaleRegionDelegations(db as unknown as Db, {
      regionId: "SN",
      countryId: "DE",
    });
    expect(n).toBe(0);
    expect(db.collectionMocks["electedOfficials"].updateOne).not.toHaveBeenCalled();
  });
});
