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
