import { describe, it, expect, vi, beforeEach } from "vitest";
import { type Db, ObjectId } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import { mergeRegion } from "./mergeRegion";

function cursorOf<T>(docs: T[]) {
  const c = {
    sort: vi.fn(() => c),
    limit: vi.fn(() => c),
    project: vi.fn(() => c),
    toArray: vi.fn().mockResolvedValue(docs),
  };
  return c;
}

describe("mergeRegion", () => {
  let db: MockDb;
  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
    db.collection("states").findOne.mockImplementation(async (f: { _id: string }) =>
      f._id === "BEO"
        ? { _id: "BEO", countryId: "DE", population: 1200, houseDistricts: 4 }
        : { _id: "BE", countryId: "DE", population: 2200, houseDistricts: 12 }
    );
    db.collection("states").updateOne.mockResolvedValue({ modifiedCount: 1 });
    db.collection("states").updateMany.mockResolvedValue({ modifiedCount: 1 });
    db.collection("electedOfficials").find.mockReturnValue(cursorOf([]));
    db.collection("electedOfficials").updateOne.mockResolvedValue({ modifiedCount: 1 });
    db.collection("seats").findOne.mockResolvedValue(null);
  });

  const run = () =>
    mergeRegion(db as unknown as Db, {
      fromRegionId: "BEO",
      toRegionId: "BE",
      currentTurn: 470,
    });

  it("adds the source's population and seats to the target", async () => {
    await run();
    const call = db.collectionMocks["states"].updateOne.mock.calls.find((c) => c[0]._id === "BE");
    expect(call?.[1].$inc).toEqual({ population: 1200, houseDistricts: 4 });
  });

  it("re-points region-keyed documents from the source to the target", async () => {
    await run();
    const call = db.collectionMocks["statePolicies"].updateMany.mock.calls[0];
    expect(call?.[0]).toEqual({ stateId: "BEO" });
    expect(call?.[1].$set.stateId).toBe("BE");
  });

  it("re-points the absorbed region's delegation at the survivor", async () => {
    await run();
    const call = db.collectionMocks["electedOfficials"].updateMany.mock.calls.find(
      (c) => c[0].state === "BEO"
    );
    expect(call?.[0]).toEqual({ countryId: "DE", state: "BEO" });
    expect(call?.[1].$set.state).toBe("BE");
  });

  it("re-apportions the fused delegations onto the surviving chamber", async () => {
    const EAST = new ObjectId();
    const WEST = new ObjectId();
    db.collection("electedOfficials").find.mockReturnValue(
      cursorOf([
        { _id: EAST, officeType: "bundestag", party: "7", seatsHeld: 4 },
        { _id: WEST, officeType: "bundestag", party: "1", seatsHeld: 12 },
      ])
    );
    // Berlin's chamber is one chamber. Two delegations arriving with their own
    // counts must not sum past it -- the summed houseDistricts is the size.
    db.collection("states").findOne.mockImplementation(async (f: { _id: string }) =>
      f._id === "BEO"
        ? { _id: "BEO", countryId: "DE", population: 1200, houseDistricts: 4 }
        : { _id: "BE", countryId: "DE", population: 2200, houseDistricts: 16 }
    );
    await run();
    const calls = db.collectionMocks["electedOfficials"].updateOne.mock.calls;
    const total = calls.reduce((sum, c) => sum + c[1].$set.seatsHeld, 0);
    expect(total).toBe(16);
  });

  it("re-homes NPPs out of the retired region", async () => {
    await run();
    const call = db.collectionMocks["npps"].updateMany.mock.calls[0];
    expect(call?.[0]).toEqual({ homeState: "BEO" });
    expect(call?.[1].$set.homeState).toBe("BE");
  });

  it("refuses a cross-border fuse rather than seating officials in a foreign region", async () => {
    db.collection("states").findOne.mockImplementation(async (f: { _id: string }) =>
      f._id === "BEO"
        ? { _id: "BEO", countryId: "DD", population: 1200 }
        : { _id: "BE", countryId: "DE", population: 2200 }
    );
    const res = await run();
    expect(res.ok).toBe(false);
    expect(res.retired).toBe(false);
    expect(db.collectionMocks["states"].updateMany).not.toHaveBeenCalled();
  });

  it("retires the source region rather than deleting it", async () => {
    const res = await run();
    const call = db.collectionMocks["states"].updateOne.mock.calls.find((c) => c[0]._id === "BEO");
    expect(call?.[1].$set.dissolvedTurn).toBe(470);
    expect(db.collectionMocks["states"].deleteOne).not.toHaveBeenCalled();
    expect(res.retired).toBe(true);
  });

  it("refuses to merge a region into itself", async () => {
    const res = await mergeRegion(db as unknown as Db, {
      fromRegionId: "BE",
      toRegionId: "BE",
      currentTurn: 470,
    });
    expect(res.ok).toBe(false);
  });

  it("is a no-op when the source is already retired", async () => {
    db.collection("states").findOne.mockResolvedValue({
      _id: "BEO",
      countryId: "DE",
      dissolvedTurn: 400,
    });
    const res = await run();
    expect(res.ok).toBe(true);
    expect(res.retired).toBe(true);
    expect(res.documentsMoved).toBe(0);
    // Nothing was re-pointed and no seats were touched on the replay.
    expect(db.collectionMocks["states"].updateMany).not.toHaveBeenCalled();
    expect(db.collectionMocks["electedOfficials"].updateOne).not.toHaveBeenCalled();
  });

  it("fails rather than inventing a target that does not exist", async () => {
    db.collection("states").findOne.mockImplementation(async (f: { _id: string }) =>
      f._id === "BEO" ? { _id: "BEO", population: 1200 } : null
    );
    const res = await run();
    expect(res.ok).toBe(false);
    expect(res.retired).toBe(false);
  });
});
