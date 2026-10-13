/** Acting and confirmed holders can exercise the same departmental capabilities. */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/api/requireAuth", () => ({ requireAuth: vi.fn() }));
vi.mock("@/lib/gameState", () => ({
  getGameState: vi.fn().mockResolvedValue({ currentTurn: 400 }),
}));

let db: MockDb;
const holderId = new ObjectId();
const generalId = new ObjectId().toString();
const plantId = new ObjectId();

beforeEach(async () => {
  db = createMockDb();
  vi.clearAllMocks();
  for (const name of [
    "cabinetMembers",
    "cabinetSettings",
    "gameState",
    "energyPlants",
    "characterGenerals",
    "nationalDoctrine",
    "characters",
  ]) {
    db.collection(name);
  }
  db.collectionMocks.gameState.findOne.mockResolvedValue({
    _id: "current",
    conflictsEnabled: true,
    currentTurn: 400,
    currentYear: 1953,
    startingYear: 1953,
  });
  db.collectionMocks.characters.findOne.mockResolvedValue({ _id: new ObjectId(generalId) });
  db.collectionMocks.characterGenerals.findOne.mockResolvedValue({
    characterId: generalId,
    commissioned: true,
    general: null,
  });
  db.collectionMocks.nationalDoctrine.findOne.mockResolvedValue({
    countryId: "US",
    adopted: {},
    points: 12,
    incomeThroughYear: 1953,
  });
  const { getDb } = await import("@/lib/mongodb");
  vi.mocked(getDb).mockResolvedValue(db as never);
  await authenticate(holderId);
});

async function authenticate(characterId: ObjectId, isAdmin = false) {
  const { requireAuth } = await import("@/lib/api/requireAuth");
  vi.mocked(requireAuth).mockResolvedValue({
    ok: true,
    user: { userId: new ObjectId().toString(), isAdmin, character: { _id: characterId } },
  } as never);
}

function seat(positionId: string, acting: boolean) {
  db.collectionMocks.cabinetMembers.findOne.mockResolvedValue({
    _id: new ObjectId(),
    countryId: "US",
    positionId,
    characterId: holderId,
    acting,
    ministerialActions: 4,
  });
}

function json(body: unknown) {
  return new Request("http://localhost", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const capabilities = [
  {
    name: "policy settings",
    positionId: "secretary_of_treasury",
    collection: "cabinetSettings",
    write: "updateOne" as const,
    invoke: async () => {
      const { POST } = await import("./setting/route");
      return POST(json({ tierSetting: "expansionary" }), {
        params: Promise.resolve({ code: "us", positionId: "secretary_of_treasury" }),
      });
    },
    verify: () =>
      expect(db.collectionMocks.cabinetSettings.updateOne).toHaveBeenCalledWith(
        { _id: "US_secretary_of_treasury" },
        { $set: expect.objectContaining({ tierSetting: "expansionary", lastChangedTurn: 400 }) },
        { upsert: true }
      ),
  },
  {
    name: "general dismissal",
    positionId: "secretary_of_defense",
    collection: "characterGenerals",
    write: "updateOne" as const,
    invoke: async () => {
      const { DELETE } = await import("./generals/[characterId]/route");
      return DELETE(new Request("http://localhost", { method: "DELETE" }), {
        params: Promise.resolve({
          code: "us",
          positionId: "secretary_of_defense",
          characterId: generalId,
        }),
      });
    },
    verify: () =>
      expect(db.collectionMocks.characterGenerals.updateOne).toHaveBeenCalledWith(
        { characterId: generalId },
        { $set: { commissioned: false, dismissedTurn: 400 } }
      ),
  },
  {
    name: "doctrine adoption",
    positionId: "secretary_of_defense",
    collection: "nationalDoctrine",
    write: "updateOne" as const,
    invoke: async () => {
      const { POST } = await import("./doctrine/adopt/route");
      return POST(json({ key: "maneuver-0" }), {
        params: Promise.resolve({ code: "us", positionId: "secretary_of_defense" }),
      });
    },
    verify: () =>
      expect(db.collectionMocks.nationalDoctrine.updateOne).toHaveBeenCalledWith(
        { countryId: "US" },
        { $set: { adopted: { "maneuver-0": 1 }, points: 11 }, $setOnInsert: { countryId: "US" } },
        { upsert: true }
      ),
  },
  {
    name: "plant retirement",
    positionId: "secretary_of_energy",
    collection: "energyPlants",
    write: "deleteOne" as const,
    invoke: async () => {
      const { DELETE } = await import("./energy/[plantId]/route");
      return DELETE(new Request("http://localhost", { method: "DELETE" }), {
        params: Promise.resolve({
          code: "us",
          positionId: "secretary_of_energy",
          plantId: plantId.toString(),
        }),
      });
    },
    verify: () =>
      expect(db.collectionMocks.energyPlants.deleteOne).toHaveBeenCalledWith({
        _id: plantId,
        countryId: "US",
        positionId: "secretary_of_energy",
      }),
  },
];

describe.each(capabilities)("cabinet authority: $name", (capability) => {
  it.each([true, false])("succeeds and persists the action when acting=%s", async (acting) => {
    seat(capability.positionId, acting);
    expect((await capability.invoke()).status).toBe(200);
    capability.verify();
  });

  it("still refuses a non-holder on an acting-held seat without writing", async () => {
    seat(capability.positionId, true);
    await authenticate(new ObjectId());
    expect((await capability.invoke()).status).toBe(403);
    expect(db.collectionMocks[capability.collection][capability.write]).not.toHaveBeenCalled();
  });

  it("still refuses a vacant seat without writing", async () => {
    db.collectionMocks.cabinetMembers.findOne.mockResolvedValue(null);
    expect((await capability.invoke()).status).toBe(403);
    expect(db.collectionMocks[capability.collection][capability.write]).not.toHaveBeenCalled();
  });

  it("preserves admin access to an acting-held seat", async () => {
    seat(capability.positionId, true);
    await authenticate(new ObjectId(), true);
    expect((await capability.invoke()).status).toBe(200);
    capability.verify();
  });
});
