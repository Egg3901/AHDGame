import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/time/gameTime", () => ({
  getGameTime: vi.fn().mockResolvedValue({ currentTurn: 100, effectiveNow: new Date(0) }),
}));
vi.mock("@/lib/congress/leadershipElections", () => ({
  isLeadershipElectionClosed: vi.fn().mockReturnValue(false),
}));

async function load() {
  return (await import("./vacateSpeakerIfLostSeat")).vacateSpeakerIfLostSeat;
}

describe("vacateSpeakerIfLostSeat — auto-open election on vacancy", () => {
  let db: MockDb;

  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
    db.collection("congressLeaders");
    db.collection("electedOfficials");
    db.collection("speakerElections");
    db.collection("speakerNominations");
    db.collectionMocks.speakerElections!.findOne.mockResolvedValue(null); // no live election
  });

  it("vacates the chair and opens a fresh election when the Speaker lost their seat", async () => {
    db.collectionMocks.congressLeaders!.findOne.mockResolvedValue({
      role: "speaker_of_the_house",
      characterId: new ObjectId(),
      characterName: "Ex Speaker",
    });
    db.collectionMocks.electedOfficials!.findOne.mockResolvedValue(null); // seat lost

    const vacateSpeakerIfLostSeat = await load();
    await vacateSpeakerIfLostSeat(db as unknown as Db);

    // Chair vacated...
    expect(db.collectionMocks.congressLeaders!.updateOne).toHaveBeenCalled();
    // ...and a new election opened.
    expect(db.collectionMocks.speakerElections!.updateOne).toHaveBeenCalled();
    const setArg = db.collectionMocks.speakerElections!.updateOne.mock.calls[0][1].$set;
    expect(setArg.status).toBe("voting");
  });

  it("does nothing when the Speaker still holds their seat", async () => {
    db.collectionMocks.congressLeaders!.findOne.mockResolvedValue({
      role: "speaker_of_the_house",
      characterId: new ObjectId(),
      characterName: "Speaker",
    });
    db.collectionMocks.electedOfficials!.findOne.mockResolvedValue({ _id: new ObjectId() });

    const vacateSpeakerIfLostSeat = await load();
    await vacateSpeakerIfLostSeat(db as unknown as Db);

    expect(db.collectionMocks.congressLeaders!.updateOne).not.toHaveBeenCalled();
    expect(db.collectionMocks.speakerElections!.updateOne).not.toHaveBeenCalled();
  });

  it("no-ops (no election re-open) when the chair is already vacant", async () => {
    db.collectionMocks.congressLeaders!.findOne.mockResolvedValue({
      role: "speaker_of_the_house",
      characterId: null,
      characterName: "Vacant",
    });

    const vacateSpeakerIfLostSeat = await load();
    await vacateSpeakerIfLostSeat(db as unknown as Db);

    expect(db.collectionMocks.speakerElections!.updateOne).not.toHaveBeenCalled();
  });
});
