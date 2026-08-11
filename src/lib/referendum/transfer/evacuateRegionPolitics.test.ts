import { beforeEach, describe, expect, it, vi } from "vitest";
import { type Db, ObjectId } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import { evacuateRegionPolitics } from "./evacuateRegionPolitics";

function cursorOf<T>(docs: T[]) {
  const c = {
    sort: vi.fn(() => c),
    limit: vi.fn(() => c),
    project: vi.fn(() => c),
    toArray: vi.fn().mockResolvedValue(docs),
  };
  return c;
}
const NPP1 = new ObjectId();
const NPP2 = new ObjectId();
const PLAYER = new ObjectId();
const ELECTION = new ObjectId();

describe("evacuateRegionPolitics", () => {
  let db: MockDb;
  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
    db.collection("npps").find.mockReturnValue(cursorOf([{ _id: NPP1 }, { _id: NPP2 }]));
    db.collection("characters").find.mockReturnValue(cursorOf([{ _id: PLAYER }]));
    db.collection("corporations").updateMany.mockResolvedValue({ modifiedCount: 1 });
    db.collection("characters").updateMany.mockResolvedValue({ modifiedCount: 1 });
    db.collection("electedOfficials").deleteMany.mockResolvedValue({ deletedCount: 11 });
    db.collection("seats").deleteMany.mockResolvedValue({ deletedCount: 9 });
    db.collection("elections").find.mockReturnValue(cursorOf([{ _id: ELECTION }]));
    db.collection("elections").deleteMany.mockResolvedValue({ deletedCount: 3 });
  });

  const run = () =>
    evacuateRegionPolitics(db as unknown as Db, {
      regionId: "NIR",
      fromCountryId: "UK",
      toCountryId: "IE",
      relocateToRegionId: "LON",
    });

  it("relocates NIR NPPs to London (staying UK) and drops their office", async () => {
    await run();
    const call = db.collectionMocks["npps"].updateMany.mock.calls[0];
    expect(call[0]).toEqual({ _id: { $in: [NPP1, NPP2] } });
    expect(call[1].$set.homeState).toBe("LON");
    expect(call[1].$set.currentOffice).toBeNull();
  });

  it("a corporation an evacuated NPP CEOs follows them to London (stays UK), for free", async () => {
    await run();
    const corpCall = db.collectionMocks["corporations"].updateMany.mock.calls.find(
      (c) => c[0].ceoType === "npp"
    );
    expect(corpCall?.[0]).toEqual({ ceoType: "npp", ceoId: { $in: [NPP1, NPP2] } });
    expect(corpCall?.[1].$set.headquartersState).toBe("LON");
    expect(corpCall?.[1].$set.countryId).toBe("UK");
  });

  it("sets resident players to Independent and clears their office fields", async () => {
    await run();
    expect(db.collectionMocks["characters"].find).toHaveBeenCalledWith({
      homeState: "NIR",
      userId: { $ne: null },
    });
    const upd = db.collectionMocks["characters"].updateMany.mock.calls[0];
    expect(upd[0]).toEqual({ _id: { $in: [PLAYER] } });
    expect(upd[1].$set.party).toBe("independent");
    expect(upd[1].$unset).toHaveProperty("currentOffice");
  });

  it("vacates a departing player from source-country offices (cabinet + head-of-gov)", async () => {
    await run();
    const filter = { countryId: "UK", characterId: { $in: [PLAYER] } };
    expect(db.collectionMocks["cabinetMembers"].deleteMany).toHaveBeenCalledWith(filter);
    const govCall = db.collectionMocks["governmentFormations"].updateMany.mock.calls[0];
    expect(govCall[0]).toEqual({ _id: "UK", headOfGovernmentCharacterId: { $in: [PLAYER] } });
    expect(govCall[1].$unset).toHaveProperty("headOfGovernmentCharacterId");
  });

  it("deletes the region's party orgs, officeholders, and seats", async () => {
    await run();
    expect(db.collectionMocks["statePartyOrg"].deleteMany).toHaveBeenCalledWith({ stateId: "NIR" });
    expect(db.collectionMocks["partyBudget"].deleteMany).toHaveBeenCalledWith({ stateId: "NIR" });
    expect(db.collectionMocks["electedOfficials"].deleteMany).toHaveBeenCalledWith({
      countryId: "UK",
      state: "NIR",
    });
    expect(db.collectionMocks["seats"].deleteMany).toHaveBeenCalledWith({
      countryId: "UK",
      state: "NIR",
    });
  });

  it("flips any remaining region-HQ'd corporations to the target country", async () => {
    await run();
    const toTarget = db.collectionMocks["corporations"].updateMany.mock.calls.find(
      (c) => c[0].headquartersState === "NIR"
    );
    expect(toTarget?.[1].$set.countryId).toBe("IE");
  });

  it("dissolves the region's active source-country races + their candidates", async () => {
    await run();
    const findCall = db.collectionMocks["elections"].find.mock.calls[0];
    expect(findCall[0]).toEqual({
      countryId: "UK",
      state: "NIR",
      status: { $in: ["active", "upcoming"] },
    });
    expect(db.collectionMocks["electionCandidates"].deleteMany).toHaveBeenCalledWith({
      electionId: { $in: [ELECTION] },
    });
    expect(db.collectionMocks["elections"].deleteMany).toHaveBeenCalledWith({
      _id: { $in: [ELECTION] },
    });
  });

  it("reports the action counts", async () => {
    const res = await run();
    expect(res.nppsRelocated).toBe(2);
    expect(res.playersToIndependent).toBe(1);
    expect(res.officialsDissolved).toBe(11);
    expect(res.seatsDissolved).toBe(9);
    expect(res.electionsDissolved).toBe(3);
  });
});
