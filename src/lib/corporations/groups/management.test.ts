import { beforeEach, describe, it, expect, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import type { Corporation } from "@/lib/db/types";
import { createInMemoryDb, type InMemoryDb } from "@/lib/test-utils/inMemoryDb";
vi.mock("@/lib/corporations/subsidiaries/authorization", () => ({
  canActOnCorporationAsParent: vi.fn(async () => true),
}));
vi.mock("@/lib/api/requireCorporationActions", () => ({
  requireCorporationActionsEnabled: vi.fn(async () => null),
}));
import { updateGroupManagement, groupManagementView } from "./management";
const rootId = new ObjectId(),
  subId = new ObjectId(),
  parentUser = new ObjectId(),
  playerUser = new ObjectId(),
  outsider = new ObjectId();
const parent = {
  _id: rootId,
  name: "Parent",
  userId: parentUser,
  ceoId: new ObjectId(),
  ceoType: "character",
  totalShares: 100,
  shareholders: [],
  groupManagement: { name: "Group", supplyPolicy: "members" },
};
const sub = {
  _id: subId,
  name: "Player subsidiary",
  userId: playerUser,
  ceoId: new ObjectId(),
  ceoType: "character",
  totalShares: 100,
  shareholders: [{ corporationId: rootId, shares: 75 }],
  subsidiaryFormalizedAtTurn: 1,
};
let memory: InMemoryDb, db: Db;
beforeEach(() => {
  memory = createInMemoryDb();
  memory.seed("corporations", [parent, sub]);
  memory.seed("gameState", [
    { _id: "current", currentTurn: 40, subsidiaryCorporationsEnabled: true },
  ]);
  db = memory as unknown as Db;
  vi.clearAllMocks();
});
async function doc(id: ObjectId) {
  return (await memory.collection("corporations").findOne({ _id: id })) as unknown as Corporation;
}
describe("group management authorization and persistence", () => {
  it("requires fresh consent when the same CEO returns for another tenure", async () => {
    await updateGroupManagement(db, await doc(subId), playerUser.toString(), {
      action: "participation",
      enabled: true,
    });
    await memory
      .collection("gameState")
      .updateOne({ _id: "current" }, { $set: { currentTurn: 50 } });
    await memory.collection("corporations").updateOne(
      { _id: subId },
      {
        $set: {
          ceoHistory: [
            { holderId: sub.ceoId, ceoType: "character", startTurn: 1, endTurn: 45 },
            { holderId: sub.ceoId, ceoType: "character", startTurn: 49 },
          ],
        },
      }
    );
    const view = await groupManagementView(db, await doc(subId), playerUser.toString());
    expect(view?.members.find((m) => m.id === subId.toString())).toMatchObject({
      receiving: false,
      requested: false,
    });
  });

  it("refuses a response to a replaced suggestion from the same turn", async () => {
    const command = {
      action: "direction" as const,
      memberId: subId.toString(),
      objective: "profit" as const,
      regions: [],
      allowInvestment: false,
    };
    await updateGroupManagement(db, await doc(rootId), parentUser.toString(), command);
    const revision = (await doc(subId)).groupDirection!.revision;
    await updateGroupManagement(db, await doc(rootId), parentUser.toString(), {
      ...command,
      objective: "balanced",
    });
    expect(
      await updateGroupManagement(db, await doc(subId), playerUser.toString(), {
        action: "respond",
        response: "acknowledged",
        revision,
      })
    ).toMatchObject({ ok: false, status: 409 });
    expect((await doc(subId)).groupDirection!.response).toBe("pending");
  });

  it("keeps a controlling block while it is reserved in an open sale", async () => {
    await memory
      .collection("corporations")
      .updateOne({ _id: subId }, { $set: { shareholders: [] } });
    memory.seed("shareOrders", [
      {
        _id: new ObjectId(),
        corporationId: subId,
        type: "sell",
        status: "open",
        placerCorporationId: rootId,
        sharesRemaining: 75,
      },
    ]);
    const view = await groupManagementView(db, await doc(rootId), parentUser.toString());
    expect(view?.canManage).toBe(true);
    expect(view?.members).toHaveLength(2);
  });

  it("allows parent identity edits and denies subsidiary/outsider edits", async () => {
    expect(
      await updateGroupManagement(db, await doc(subId), playerUser.toString(), {
        action: "identity",
        name: "Hijack",
      })
    ).toMatchObject({ ok: false, status: 403 });
    expect(
      await updateGroupManagement(db, await doc(rootId), outsider.toString(), {
        action: "policy",
        policy: "independent",
      })
    ).toMatchObject({ ok: false, status: 403 });
    expect(
      await updateGroupManagement(db, await doc(rootId), parentUser.toString(), {
        action: "identity",
        name: "Chosen Group",
      })
    ).toEqual({ ok: true });
    expect((await doc(rootId)).groupManagement?.name).toBe("Chosen Group");
  });
  it("lets only the operating player set next-turn receiving consent", async () => {
    expect(
      await updateGroupManagement(db, await doc(subId), parentUser.toString(), {
        action: "participation",
        enabled: true,
      })
    ).toMatchObject({ ok: false, status: 403 });
    expect(
      await updateGroupManagement(db, await doc(subId), playerUser.toString(), {
        action: "participation",
        enabled: true,
      })
    ).toEqual({ ok: true });
    const saved = (await doc(subId)).groupReceiving;
    expect(saved).toMatchObject({
      enabled: true,
      previousEnabled: false,
      effectiveTurn: 41,
      rootId: rootId.toString(),
      ceoId: sub.ceoId.toString(),
    });
    const own = await groupManagementView(db, await doc(subId), playerUser.toString());
    expect(own?.members.find((m) => m.id === subId.toString())).toMatchObject({
      receiving: false,
      requested: true,
      effectiveTurn: 41,
    });
    expect(own?.members.find((m) => m.id === rootId.toString())?.receiving).toBeNull();
  });
  it("does not expose private preferences and suggestions to another player", async () => {
    await updateGroupManagement(db, await doc(subId), playerUser.toString(), {
      action: "participation",
      enabled: true,
    });
    const view = await groupManagementView(db, await doc(subId), outsider.toString());
    expect(view?.canManage).toBe(false);
    expect(view?.members.every((m) => m.receiving === null && m.direction === null)).toBe(true);
  });
  it("retains consent but refuses changes under commercial independence", async () => {
    await updateGroupManagement(db, await doc(subId), playerUser.toString(), {
      action: "participation",
      enabled: true,
    });
    await updateGroupManagement(db, await doc(rootId), parentUser.toString(), {
      action: "policy",
      policy: "independent",
    });
    expect(
      await updateGroupManagement(db, await doc(subId), playerUser.toString(), {
        action: "participation",
        enabled: false,
      })
    ).toMatchObject({ ok: false, status: 409 });
    expect((await doc(subId)).groupReceiving?.enabled).toBe(true);
  });
  it("invalidates settings access when the group dissolves", async () => {
    await memory
      .collection("corporations")
      .updateOne({ _id: subId }, { $set: { shareholders: [] } });
    expect(await groupManagementView(db, await doc(subId), playerUser.toString())).toBeNull();
    expect(
      await updateGroupManagement(db, await doc(subId), playerUser.toString(), {
        action: "participation",
        enabled: true,
      })
    ).toMatchObject({ ok: false, status: 409 });
  });
  it("saves a suggestion and only its receiving CEO can answer", async () => {
    expect(
      await updateGroupManagement(db, await doc(rootId), parentUser.toString(), {
        action: "direction",
        memberId: subId.toString(),
        objective: "regional",
        regions: ["US-PA"],
        allowInvestment: true,
      })
    ).toEqual({ ok: true });
    expect(
      await updateGroupManagement(db, await doc(subId), parentUser.toString(), {
        action: "respond",
        response: "acknowledged",
        revision: (await doc(subId)).groupDirection!.revision,
      })
    ).toMatchObject({ ok: false, status: 403 });
    expect(
      await updateGroupManagement(db, await doc(subId), playerUser.toString(), {
        action: "respond",
        response: "declined",
        revision: (await doc(subId)).groupDirection!.revision,
      })
    ).toEqual({ ok: true });
    expect((await doc(subId)).groupDirection?.response).toBe("declined");
  });
  it("fails closed when subsidiary management is disabled", async () => {
    await memory
      .collection("gameState")
      .updateOne({ _id: "current" }, { $set: { subsidiaryCorporationsEnabled: false } });
    expect(
      await updateGroupManagement(db, await doc(rootId), parentUser.toString(), {
        action: "identity",
        name: "Hidden",
      })
    ).toMatchObject({ ok: false, status: 409 });
  });
});
