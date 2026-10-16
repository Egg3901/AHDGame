import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import type { Corporation } from "@/lib/db/types";
import { appointSubsidiaryCeo } from "./appointSubsidiaryCeo";

vi.mock("@/lib/corporations/reservedCorporateHoldings", () => ({
  resolveControllingCorporateParent: vi.fn(),
}));
vi.mock("../authorization", () => ({ canActOnCorporationAsParent: vi.fn() }));
vi.mock("../helpers", () => ({
  subsidiaryCeoBlockMessage: vi.fn(() => "Blocked"),
  subsidiaryCeoBlockReason: vi.fn(),
}));
vi.mock("../parentContext", () => ({
  collectSiblingSubsidiaryCeoUserIds: vi.fn(),
  resolveParentCeoUserId: vi.fn(),
}));

describe("appointSubsidiaryCeo residency", () => {
  let db: MockDb;
  const callerUserId = new ObjectId();
  const parentId = new ObjectId();
  const subId = new ObjectId();
  const candidateId = new ObjectId();
  const parent = { _id: parentId, userId: callerUserId } as Corporation;
  const sub = {
    _id: subId,
    name: "Texas subsidiary",
    countryId: "US",
    headquartersState: "US_TX",
    ceoId: new ObjectId(),
  } as Corporation;

  beforeEach(async () => {
    vi.clearAllMocks();
    db = createMockDb();
    db.collection("corporations");
    db.collection("characters");
    db.collectionMocks.corporations.findOne.mockResolvedValue(parent as never);
    db.collectionMocks.characters.findOne.mockResolvedValue({
      _id: candidateId,
      userId: new ObjectId(),
      homeState: "JP_TK",
      countryId: "JP",
    } as never);

    const { canActOnCorporationAsParent } = await import("../authorization");
    const { resolveControllingCorporateParent } =
      await import("@/lib/corporations/reservedCorporateHoldings");
    const parentContext = await import("../parentContext");
    vi.mocked(canActOnCorporationAsParent).mockResolvedValue(true);
    vi.mocked(resolveControllingCorporateParent).mockResolvedValue({
      corporationId: parentId,
    } as never);
    vi.mocked(parentContext.resolveParentCeoUserId).mockResolvedValue(null as never);
    vi.mocked(parentContext.collectSiblingSubsidiaryCeoUserIds).mockResolvedValue([]);
  });

  it("rejects a character outside the subsidiary's headquarters state", async () => {
    const result = await appointSubsidiaryCeo(db as never, {
      sub,
      callerUserId,
      ceoType: "character",
      characterId: candidateId,
      turn: 12,
      now: new Date("2026-10-15T12:00:00Z"),
    });

    expect(result).toEqual({
      ok: false,
      status: 403,
      error: "The appointed CEO must reside in the subsidiary's headquarters state.",
    });
    expect(db.collectionMocks.corporations.updateOne).not.toHaveBeenCalled();
  });

  it("allows a resident character in the same state and country", async () => {
    db.collectionMocks.characters.findOne.mockResolvedValue({
      _id: candidateId,
      userId: new ObjectId(),
      homeState: "US_TX",
      countryId: "US",
    } as never);

    const result = await appointSubsidiaryCeo(db as never, {
      sub,
      callerUserId,
      ceoType: "character",
      characterId: candidateId,
      turn: 12,
      now: new Date("2026-10-15T12:00:00Z"),
    });

    expect(result).toEqual({ ok: true, ceoType: "character" });
    const firstWrite = db.collectionMocks.corporations.updateOne.mock.calls[0]![1] as {
      $set: Record<string, unknown>;
    };
    expect(firstWrite.$set.ceoId).toEqual(candidateId);
  });
});

describe("appointSubsidiaryCeo NPP appointments", () => {
  let db: MockDb;
  const callerUserId = new ObjectId();
  const parentId = new ObjectId();
  const nppId = new ObjectId();
  const now = new Date("2026-10-16T07:00:00Z");
  const turn = 42;
  const vacantSub = {
    _id: new ObjectId(),
    name: "Vacant subsidiary",
    countryId: "US",
    ceoType: "character",
    ceoVacant: true,
    ceoVacantSinceTurn: 40,
    subsidiaryFormalizedAtTurn: 30,
    totalShares: 100,
    shareholders: [{ corporationId: parentId, shares: 80 }],
  } as Corporation;

  beforeEach(async () => {
    vi.clearAllMocks();
    db = createMockDb();
    db.collection("corporations").findOne.mockResolvedValue({
      _id: parentId,
      userId: callerUserId,
    } as never);
    db.collection("politicalParties")
      .find()
      .toArray.mockResolvedValue([{ sequentialId: 5 }]);
    db.collection("npps")
      .find()
      .toArray.mockResolvedValue([
        { _id: nppId, party: "5", politicalInfluence: 50, sequentialId: 1 },
      ]);
    db.collection("npps").findOne.mockResolvedValue({ _id: nppId, name: "Eligible NPP" } as never);

    const { canActOnCorporationAsParent } = await import("../authorization");
    const { resolveControllingCorporateParent } =
      await import("@/lib/corporations/reservedCorporateHoldings");
    vi.mocked(canActOnCorporationAsParent).mockResolvedValue(true);
    vi.mocked(resolveControllingCorporateParent).mockResolvedValue({
      corporationId: parentId,
    } as never);
  });

  function appoint(sub = vacantSub, forcedNppId?: string) {
    return appointSubsidiaryCeo(db as never, {
      sub,
      callerUserId,
      ceoType: "npp",
      forcedNppId,
      turn,
      now,
    });
  }

  it("seats an eligible NPP in an ownerless vacant subsidiary and opens its tenure", async () => {
    expect(await appoint()).toEqual({ ok: true, ceoType: "npp", nppName: "Eligible NPP" });
    const update = db.collectionMocks.corporations.updateOne;
    expect(update).toHaveBeenCalledWith(
      { _id: vacantSub._id },
      {
        $set: { ceoId: nppId, ceoType: "npp", ceoVacant: false, ceoSalary: 0, updatedAt: now },
        $unset: { pendingCeoCharacterId: "", ceoVacantSinceTurn: "" },
      }
    );
    expect(update).toHaveBeenCalledWith(
      { _id: vacantSub._id },
      { $push: { ceoHistory: { holderId: nppId, ceoType: "npp", startTurn: turn } } }
    );
    // No owner or human caretaker stash is fabricated by any write.
    for (const [, write] of update.mock.calls) {
      expect(write.$set ?? {}).not.toHaveProperty("userId");
      expect(write.$set ?? {}).not.toHaveProperty("caretakerCeo");
    }
  });

  it("preserves a surviving owner without fabricating a departed human", async () => {
    const userId = new ObjectId();
    expect(await appoint({ ...vacantSub, userId })).toMatchObject({ ok: true });
    const write = db.collectionMocks.corporations.updateOne.mock.calls[0]![1];
    expect(write.$set.caretakerCeo).toEqual({
      underlyingUserId: userId,
      appointedTurn: turn,
      appointmentSource: "vacancy",
      mandate: "active",
    });
    expect(write.$set ?? {}).not.toHaveProperty("userId");
    expect(write.$unset).not.toHaveProperty("userId");
  });

  it("returns a useful error without writes when no eligible NPP exists", async () => {
    db.collection("npps").find().toArray.mockResolvedValue([]);
    expect(await appoint()).toMatchObject({
      ok: false,
      error: "No eligible NPP is available to caretake this subsidiary.",
    });
    expect(db.collectionMocks.corporations.updateOne).not.toHaveBeenCalled();
  });

  it("rejects a forced NPP outside the eligible pool without writes", async () => {
    expect(await appoint(vacantSub, new ObjectId().toString())).toMatchObject({
      ok: false,
      error: "No eligible NPP is available to caretake this subsidiary.",
    });
    expect(db.collectionMocks.corporations.updateOne).not.toHaveBeenCalled();
  });

  it("honors a forced eligible NPP", async () => {
    expect(await appoint(vacantSub, nppId.toString())).toMatchObject({ ok: true });
    expect(db.collectionMocks.corporations.updateOne.mock.calls[0]![1].$set.ceoId).toEqual(nppId);
  });

  it("rejects an unauthorized caller without writes", async () => {
    const { canActOnCorporationAsParent } = await import("../authorization");
    vi.mocked(canActOnCorporationAsParent).mockResolvedValue(false);
    expect(await appoint()).toMatchObject({ ok: false, status: 403 });
    expect(db.collectionMocks.corporations.updateOne).not.toHaveBeenCalled();
  });

  it("rejects lost derived parent control without writes", async () => {
    const { resolveControllingCorporateParent } =
      await import("@/lib/corporations/reservedCorporateHoldings");
    vi.mocked(resolveControllingCorporateParent).mockResolvedValue(null);
    expect(await appoint()).toMatchObject({ ok: false, status: 409 });
    expect(db.collectionMocks.corporations.updateOne).not.toHaveBeenCalled();
  });

  it("keeps the sitting-human caretaker handoff and closes the human tenure", async () => {
    const ceoId = new ObjectId();
    const userId = new ObjectId();
    expect(await appoint({ ...vacantSub, ceoVacant: false, ceoId, userId })).toMatchObject({
      ok: true,
    });
    const update = db.collectionMocks.corporations.updateOne;
    expect(update.mock.calls[0]![1].$set.caretakerCeo).toEqual({
      underlyingCharacterId: ceoId,
      underlyingUserId: userId,
      appointedTurn: turn,
      appointmentSource: "owner",
      mandate: "active",
    });
    expect(update).toHaveBeenCalledWith(
      { _id: vacantSub._id, ceoHistory: { $exists: true } },
      { $set: { "ceoHistory.$[t].endTurn": turn } },
      { arrayFilters: [{ "t.holderId": ceoId, "t.endTurn": { $exists: false } }] }
    );
  });

  it.each([true, false])(
    "explains an active cooldown with ceoVacant=%s and does not write",
    async (ceoVacant) => {
      expect(
        await appoint({ ...vacantSub, ceoVacant, caretakerCooldownUntilTurn: turn + 1 })
      ).toMatchObject({
        ok: false,
        error: "This subsidiary must wait until its caretaker reappointment cooldown ends.",
      });
      expect(db.collectionMocks.corporations.updateOne).not.toHaveBeenCalled();
    }
  );

  it("allows a vacant appointment at the cooldown boundary", async () => {
    expect(await appoint({ ...vacantSub, caretakerCooldownUntilTurn: turn })).toMatchObject({
      ok: true,
    });
  });
});
