import { ObjectId } from "mongodb";
import { describe, expect, it, vi } from "vitest";
import { createMockDb } from "@/lib/test-utils/mockDb";
import { emptyConflictState } from "@/lib/livingConflict/engine";
import { initialUKDevolutionState } from "../devolution/rules";
import { reconcileNorthernIrelandGovernance, northernIrelandAssemblyAllows } from "./service";

function fixture() {
  const db = createMockDb();
  for (const name of [
    "gameState",
    "states",
    "ukDevolution",
    "elections",
    "electedOfficials",
    "electionCandidates",
    "governorOfficeState",
    "characters",
    "npps",
  ])
    db.collection(name);
  db.collectionMocks.gameState!.findOne.mockResolvedValue({ startingYear: 1991 });
  db.collectionMocks.states!.findOne.mockResolvedValue({ _id: "NIR", countryId: "UK" });
  db.collectionMocks.ukDevolution!.findOne.mockResolvedValue(initialUKDevolutionState(1991));
  return db;
}
const conflict = {
  ...emptyConflictState("northern_ireland"),
  hasOpened: true,
  phaseLevel: 6,
  status: "settled" as const,
  tracks: { ratificationAuthorization: 2, referendumRatification: 1 },
};

describe("NI governance shell", () => {
  it("establishes only NIR and does not invent an officeholder", async () => {
    const db = fixture();
    db.collectionMocks.elections!.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([
        { electionType: "governor", cycle: 2 },
        { electionType: "regionalCouncil", cycle: 4 },
      ]),
    });
    await reconcileNorthernIrelandGovernance(db, conflict, 100);
    expect(db.collectionMocks.ukDevolution!.updateOne).toHaveBeenCalledWith(
      { _id: "UK" },
      expect.objectContaining({
        $set: expect.objectContaining({
          regions: expect.objectContaining({
            NIR: { active: true, firstCycle: 3, firstElectionEndTurn: 172 },
            SCO: { active: false, firstCycle: 1 },
          }),
        }),
      }),
      { upsert: true }
    );
    expect(db.collectionMocks.electedOfficials!.updateMany).not.toHaveBeenCalled();
  });
  it("cancels live elections and withdraws candidates before persisting suspension", async () => {
    const db = fixture();
    const id = new ObjectId();
    db.collectionMocks.ukDevolution!.findOne.mockResolvedValue({
      ...initialUKDevolutionState(2019),
      northernIrelandPeace: { posture: "power_sharing", changedTurn: 50 },
    });
    db.collectionMocks.elections!.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([{ _id: id, electionType: "governor", cycle: 2 }]),
    });
    await reconcileNorthernIrelandGovernance(
      db,
      { ...conflict, phaseLevel: 7, status: "negotiating" },
      200
    );
    expect(db.collectionMocks.electionCandidates!.updateMany).toHaveBeenCalledWith(
      { electionId: { $in: [id] }, status: "active" },
      expect.objectContaining({ $set: expect.objectContaining({ status: "withdrawn" }) })
    );
    expect(db.collectionMocks.electedOfficials!.updateMany).toHaveBeenCalled();
    expect(db.collectionMocks.ukDevolution!.updateOne).toHaveBeenCalledOnce();
  });
  it("leaves modern institutions unchanged merely because a new window opens", async () => {
    const db = fixture();
    db.collectionMocks.gameState!.findOne.mockResolvedValue({ startingYear: 2027 });
    db.collectionMocks.ukDevolution!.findOne.mockResolvedValue(initialUKDevolutionState(2027));
    await reconcileNorthernIrelandGovernance(
      db,
      { ...conflict, phaseLevel: 1, status: "active" },
      10
    );
    expect(db.collectionMocks.ukDevolution!.updateOne).not.toHaveBeenCalled();
  });
  it("blocks only the suspended NI chamber and preserves legacy behavior", async () => {
    const db = fixture();
    expect(await northernIrelandAssemblyAllows(db, "UK", "NIR")).toBe(true);
    db.collectionMocks.ukDevolution!.findOne.mockResolvedValue({
      ...initialUKDevolutionState(1991),
      northernIrelandPeace: { posture: "suspended", changedTurn: 10 },
    });
    expect(await northernIrelandAssemblyAllows(db, "UK", "NIR")).toBe(false);
    expect(await northernIrelandAssemblyAllows(db, "UK", "SCO")).toBe(true);
  });
});
