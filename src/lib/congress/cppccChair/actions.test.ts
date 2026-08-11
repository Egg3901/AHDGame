import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import type { getNpcComposition } from "@/lib/congress/npcComposition";

const FIXED_NOW = new Date("2026-01-01T00:00:00.000Z");

vi.mock("@/lib/time/gameTime", () => ({
  getGameTime: vi.fn().mockResolvedValue({ currentTurn: 100, effectiveNow: FIXED_NOW }),
}));
vi.mock("@/lib/congress/leadershipElections", () => ({
  isLeadershipElectionClosed: vi.fn().mockReturnValue(false),
}));

// CCP is the largest NPC party; CDL is a smaller seated party.
const NPC_COMPOSITION = {
  composition: [
    { party: "ccp", partyName: "Chinese Communist Party" },
    { party: "cdl", partyName: "China Democratic League" },
  ],
  majorityParty: "ccp",
  majorityBloc: null,
} as unknown as Awaited<ReturnType<typeof getNpcComposition>>;

describe("handleCppccChairAction (largest-single-party eligibility)", () => {
  let db: MockDb;
  const userId = new ObjectId();

  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
    db.collection("characters");
    db.collection("electedOfficials");
    db.collection("cppccChairElections");
    db.collection("cppccChairNominations");
  });

  function ctxFor(party: string, action: string) {
    const charId = new ObjectId();
    db.collectionMocks.characters!.findOne.mockResolvedValue({
      _id: charId,
      name: "Delegate",
      party,
    });
    db.collectionMocks.electedOfficials!.findOne.mockResolvedValue({
      _id: new ObjectId(),
      characterId: charId,
      officeType: "npcDelegate",
      countryId: "CN",
      state: "BEIJING",
    });
    db.collectionMocks.cppccChairElections!.findOne.mockResolvedValue({
      _id: "current",
      status: "voting",
    });
    db.collectionMocks.cppccChairNominations!.findOne.mockResolvedValue(null);
    return {
      db: db as unknown as Db,
      partyMap: new Map(),
      npc: NPC_COMPOSITION,
      authUser: { userId: userId.toString(), isAdmin: false },
      action,
    };
  }

  it("lets a CCP (largest-party) NPC delegate declare", async () => {
    const { handleCppccChairAction } = await import("./actions");
    const result = await handleCppccChairAction(ctxFor("ccp", "declare"));
    expect(result.success).toBe(true);
    expect(db.collectionMocks.cppccChairNominations!.insertOne).toHaveBeenCalledTimes(1);
  });

  it("rejects a non-largest-party (CDL) NPC delegate from declaring", async () => {
    const { handleCppccChairAction } = await import("./actions");
    const result = await handleCppccChairAction(ctxFor("cdl", "declare"));
    expect(result.success).toBe(false);
    if (!result.success) expect(result.status).toBe(403);
    expect(db.collectionMocks.cppccChairNominations!.insertOne).not.toHaveBeenCalled();
  });

  it("requires admin for start_election", async () => {
    const { handleCppccChairAction } = await import("./actions");
    const result = await handleCppccChairAction({
      db: db as unknown as Db,
      partyMap: new Map(),
      npc: NPC_COMPOSITION,
      authUser: { userId: userId.toString(), isAdmin: false },
      action: "start_election",
    });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.status).toBe(403);
  });
});
