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

describe("evacuateRegionPolitics when the source country is dissolving", () => {
  let db: MockDb;
  const DEPUTY = new ObjectId();
  const CHAIRMAN = new ObjectId();

  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
    db.collection("npps").find.mockReturnValue(cursorOf([{ _id: NPP1 }]));
    db.collection("characters").find.mockReturnValue(cursorOf([{ _id: PLAYER }]));
    db.collection("corporations").updateMany.mockResolvedValue({ modifiedCount: 0 });
    db.collection("characters").updateMany.mockResolvedValue({ modifiedCount: 1 });
    db.collection("electedOfficials").find.mockReturnValue(
      cursorOf([
        { _id: DEPUTY, officeType: "volkskammerDeputy", state: "SN", party: "7", seatsHeld: 60 },
        { _id: CHAIRMAN, officeType: "chairmanOfStateCouncil", state: "SN", party: "7" },
      ])
    );
    db.collection("electedOfficials").updateOne.mockResolvedValue({ modifiedCount: 1 });
    db.collection("electedOfficials").deleteMany.mockResolvedValue({ deletedCount: 0 });
    db.collection("elections").find.mockReturnValue(cursorOf([]));
    db.collection("seats").findOne.mockResolvedValue(null);
  });

  const run = () =>
    evacuateRegionPolitics(db as unknown as Db, {
      regionId: "SN",
      fromCountryId: "DD",
      toCountryId: "DE",
      relocateToRegionId: null,
    });

  it("does not force resident players to independent", async () => {
    await run();
    const upd = db.collectionMocks["characters"].updateMany.mock.calls[0];
    expect(upd?.[1].$set?.party).toBeUndefined();
  });

  it("does not delete the departing players' offices", async () => {
    await run();
    expect(db.collectionMocks["electedOfficials"].deleteMany.mock.calls).toHaveLength(0);
  });

  it("leaves the cabinet alone, because position ids do not survive a border", async () => {
    await run();
    // East Germany seats a `minister_of_defence`; Germany a `defense_minister`.
    // The cabinet is retired at country level by `retireNationalRemnants`, not
    // re-scoped here into portfolios the surviving country does not define.
    // Asserted on collection ACCESS: a collection never touched has no mock.
    expect(db.collection.mock.calls.map((c) => c[0])).not.toContain("cabinetMembers");
  });

  it("remaps a Volkskammer deputy into the Bundestag", async () => {
    const res = await run();
    const call = db.collectionMocks["electedOfficials"].updateOne.mock.calls.find(
      (c) => String(c[0]._id) === String(DEPUTY)
    );
    expect(call?.[1].$set.officeType).toBe("bundestag");
    expect(call?.[1].$set.countryId).toBe("DE");
    expect(res.officialsRemapped).toBe(1);
  });

  it("retires an office with no counterpart instead of carrying it", async () => {
    const res = await run();
    const call = db.collectionMocks["electedOfficials"].deleteOne.mock.calls.find(
      (c) => String(c[0]._id) === String(CHAIRMAN)
    );
    expect(call).toBeDefined();
    expect(res.officialsRetired).toBe(1);
  });

  it("keeps the region's party organisations instead of deleting them", async () => {
    await run();
    expect(db.collectionMocks["statePartyOrg"].deleteMany).not.toHaveBeenCalled();
    const call = db.collectionMocks["statePartyOrg"].updateMany.mock.calls[0];
    expect(call?.[1].$set.countryId).toBe("DE");
  });

  it("remaps the office without touching the seat count", async () => {
    // The chamber's size comes from the region's `houseDistricts`, which
    // `convertRegionDoc` has not written yet when this runs. `transferRegion`
    // rescales the delegation immediately afterwards, once the size is real.
    await run();
    const call = db.collectionMocks["electedOfficials"].updateOne.mock.calls.find(
      (c) => String(c[0]._id) === String(DEPUTY)
    );
    expect(call?.[1].$set.officeType).toBe("bundestag");
    expect(call?.[1].$set.seatsHeld).toBeUndefined();
  });

  it("keeps NPP officeholders in the office their seat was carried into", async () => {
    const NPPX = new ObjectId();
    db.collection("electedOfficials").find.mockReturnValue(
      cursorOf([
        {
          _id: DEPUTY,
          officeType: "volkskammerDeputy",
          state: "SN",
          party: "7",
          seatsHeld: 60,
          nppId: NPPX,
        },
      ])
    );
    await run();
    // Most seats here are NPP-held. Nulling their office while carrying the seat
    // would leave the row intact and the politician holding nothing.
    const bulk = db.collectionMocks["npps"].updateMany.mock.calls[0];
    expect(bulk?.[1].$set).not.toHaveProperty("currentOffice");
    const one = db.collectionMocks["npps"].updateOne.mock.calls.find(
      (c) => String(c[0]._id) === String(NPPX)
    );
    expect(one?.[1].$set["currentOffice.type"]).toBe("bundestag");
  });

  it("re-points the carried player's own office label at the new chamber", async () => {
    const CHAR = new ObjectId();
    db.collection("electedOfficials").find.mockReturnValue(
      cursorOf([
        {
          _id: DEPUTY,
          officeType: "volkskammerDeputy",
          state: "SN",
          party: "7",
          seatsHeld: 60,
          characterId: CHAR,
        },
      ])
    );
    await run();
    // `characters.currentOffice` is stored, not derived, and `actionRefresh`
    // looks the key up in the country's config: a player left holding
    // `volkskammerDeputy` in Germany matches nothing and loses their bonus.
    const call = db.collectionMocks["characters"].updateOne.mock.calls.find(
      (c) => String(c[0]._id) === String(CHAR)
    );
    expect(call?.[1].$set["currentOffice.type"]).toBe("bundestag");
  });

  it("dissolves the delegation when the country pair has no office mapping", async () => {
    // An unregistered pair has no statement about how one constitution's offices
    // become another's. Guessing would seat people in bodies nobody mapped.
    const res = await evacuateRegionPolitics(db as unknown as Db, {
      regionId: "SN",
      fromCountryId: "PL",
      toCountryId: "RU",
      relocateToRegionId: null,
    });
    expect(res.officialsRemapped).toBe(0);
    expect(db.collectionMocks["electedOfficials"].deleteMany).toHaveBeenCalledWith({
      countryId: "PL",
      state: "SN",
    });
  });

  it("remaps a Land First Secretary to a Minister-President", async () => {
    const GOV = new ObjectId();
    db.collection("electedOfficials").find.mockReturnValue(
      cursorOf([{ _id: GOV, officeType: "governor", state: "SN", party: "7", seatsHeld: 0 }])
    );
    await run();
    const call = db.collectionMocks["electedOfficials"].updateOne.mock.calls.find(
      (c) => String(c[0]._id) === String(GOV)
    );
    expect(call?.[1].$set.officeType).toBe("ministerPresident");
  });
});
