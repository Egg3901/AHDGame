import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
vi.mock("@/lib/turn/rulingPartyConfidence", () => ({
  installNewLeader: vi.fn().mockResolvedValue(undefined),
}));
import { installNewLeader } from "@/lib/turn/rulingPartyConfidence";
import { migration } from "./2026-10-04-government-accountability";
let db: MockDb;
const leader = new ObjectId();
beforeEach(() => {
  vi.clearAllMocks();
  db = createMockDb();
  db.collection("governmentFormations")
    .find()
    .toArray.mockResolvedValue([
      {
        _id: "CN",
        countryId: "CN",
        status: "formed",
        governingPartyId: "2",
        pmNppId: leader,
        pmCharacterId: null,
        formedTurn: 10,
      },
    ]);
  db.collection("npps")
    .find()
    .toArray.mockResolvedValue([{ _id: leader, party: "1" }]);
  db.collection("countryState")
    .find()
    .toArray.mockResolvedValue([
      { _id: "CN", governmentType: "onePartyState", hasLeaderConfidenceModel: true },
    ]);
  db.collection("gameState").findOne.mockResolvedValue({ currentTurn: 100 });
});
describe("government accountability migration", () => {
  it("clears a presidential legislative-majority label without resetting its mandate", async () => {
    db.collection("governmentFormations")
      .find()
      .toArray.mockResolvedValue([
        {
          _id: "US",
          countryId: "US",
          status: "formed",
          governingPartyId: "1",
          formationType: "majority",
          pmNppId: leader,
          formedTurn: 3,
        },
      ]);
    db.collection("electedOfficials")
      .find()
      .toArray.mockResolvedValue([
        { countryId: "US", officeType: "president", nppId: leader, party: "1" },
      ]);
    db.collection("countryState")
      .find()
      .toArray.mockResolvedValue([
        { _id: "US", governmentType: "presidential", hasLeaderConfidenceModel: false },
      ]);
    const preview = await migration.execute(db as unknown as Db, { dryRun: true });
    expect(preview.documentsUpdated).toBe(1);
    expect(db.collection("governmentFormations").updateOne).not.toHaveBeenCalled();
    await migration.execute(db as unknown as Db, { dryRun: false });
    expect(db.collection("governmentFormations").updateOne).toHaveBeenCalledExactlyOnceWith(
      { _id: "US", status: "formed" },
      { $set: { formationType: null } }
    );
    expect(installNewLeader).not.toHaveBeenCalled();
  });
  it("previews identity repairs and new leader states without writing", async () => {
    const result = await migration.execute(db as unknown as Db, { dryRun: true });
    expect(result.documentsUpdated).toBe(1);
    expect(result.documentsInserted).toBe(1);
    expect(installNewLeader).not.toHaveBeenCalled();
    expect(db.collection("governmentFormations").updateOne).not.toHaveBeenCalled();
    expect(db.collection("politicalParties").updateOne).not.toHaveBeenCalled();
  });
  it("repairs attribution but preserves the mandate clock and existing state on a repeat", async () => {
    await migration.execute(db as unknown as Db, { dryRun: false });
    expect(db.collection("governmentFormations").updateOne).toHaveBeenCalledWith(
      { _id: "CN", status: "formed" },
      { $set: { governingPartyId: "1" } }
    );
    expect(installNewLeader).toHaveBeenCalledWith(
      expect.anything(),
      "CN",
      { kind: "npp", id: leader },
      "premier",
      "1",
      10
    );
    db.collection("governmentFormations")
      .find()
      .toArray.mockResolvedValue([
        {
          _id: "CN",
          countryId: "CN",
          status: "formed",
          governingPartyId: "1",
          pmNppId: leader,
          pmCharacterId: null,
        },
      ]);
    db.collection("countryLeaderStates").findOne.mockResolvedValue({
      _id: `CN_npp_${leader}`,
      partyConfidence: 18,
    });
    const again = await migration.execute(db as unknown as Db, { dryRun: false });
    expect(again.documentsUpdated).toBe(0);
    expect(again.documentsInserted).toBe(0);
    expect(installNewLeader).toHaveBeenCalledTimes(1);
  });
});
