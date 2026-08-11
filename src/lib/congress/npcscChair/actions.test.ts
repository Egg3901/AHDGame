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

// A minimal NPC composition with the CCP as the only seated party.
const NPC_COMPOSITION = {
  composition: [{ party: "ccp", partyName: "Chinese Communist Party" }],
  majorityParty: "ccp",
  majorityBloc: null,
} as unknown as Awaited<ReturnType<typeof getNpcComposition>>;

describe("handleNpcscChairAction", () => {
  let db: MockDb;
  const userId = new ObjectId();

  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
    db.collection("characters");
    db.collection("electedOfficials");
    db.collection("npcscChairElections");
    db.collection("npcscChairNominations");
  });

  function baseCtx(action: string) {
    return {
      db: db as unknown as Db,
      partyMap: new Map(),
      npc: NPC_COMPOSITION,
      authUser: { userId: userId.toString(), isAdmin: false },
      action,
    };
  }

  it("rejects participation from a non-NPC-delegate", async () => {
    db.collectionMocks.characters!.findOne.mockResolvedValue({
      _id: new ObjectId(),
      name: "Outsider",
      party: "ccp",
    });
    db.collectionMocks.electedOfficials!.findOne.mockResolvedValue(null); // not a delegate

    const { handleNpcscChairAction } = await import("./actions");
    const result = await handleNpcscChairAction(baseCtx("declare"));

    expect(result.success).toBe(false);
    if (!result.success) expect(result.status).toBe(403);
  });

  it("lets an eligible seated CCP delegate declare during an open election", async () => {
    const charId = new ObjectId();
    db.collectionMocks.characters!.findOne.mockResolvedValue({
      _id: charId,
      name: "Delegate Li",
      party: "ccp",
    });
    db.collectionMocks.electedOfficials!.findOne.mockResolvedValue({
      _id: new ObjectId(),
      characterId: charId,
      officeType: "npcDelegate",
      countryId: "CN",
      state: "BEIJING",
    });
    db.collectionMocks.npcscChairElections!.findOne.mockResolvedValue({
      _id: "current",
      status: "voting",
    });
    // No existing nomination for this character.
    db.collectionMocks.npcscChairNominations!.findOne.mockResolvedValue(null);

    const { handleNpcscChairAction } = await import("./actions");
    const result = await handleNpcscChairAction(baseCtx("declare"));

    expect(result.success).toBe(true);
    const insert = db.collectionMocks.npcscChairNominations!.insertOne;
    expect(insert).toHaveBeenCalledTimes(1);
    expect(insert.mock.calls[0][0]).toMatchObject({
      nomineeId: charId,
      nomineeParty: "ccp",
      nomineeCountryId: "CN",
      status: "open",
    });
  });

  it("rejects declare when no election is open", async () => {
    const charId = new ObjectId();
    db.collectionMocks.characters!.findOne.mockResolvedValue({
      _id: charId,
      name: "Delegate Li",
      party: "ccp",
    });
    db.collectionMocks.electedOfficials!.findOne.mockResolvedValue({
      _id: new ObjectId(),
      characterId: charId,
      officeType: "npcDelegate",
      countryId: "CN",
    });
    db.collectionMocks.npcscChairElections!.findOne.mockResolvedValue(null); // no election

    const { handleNpcscChairAction } = await import("./actions");
    const result = await handleNpcscChairAction(baseCtx("declare"));

    expect(result.success).toBe(false);
    if (!result.success) expect(result.status).toBe(409);
  });

  it("requires admin for start_election", async () => {
    const { handleNpcscChairAction } = await import("./actions");
    const result = await handleNpcscChairAction(baseCtx("start_election"));
    expect(result.success).toBe(false);
    if (!result.success) expect(result.status).toBe(403);
  });
});
