import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import { getEventHandler } from "@/lib/events/substrate/registry";
import { offerEvent } from "@/lib/events/substrate/offer";
import { resolveEvent } from "@/lib/events/substrate/resolve";
import { countryScopeId } from "@/lib/events/substrate/countryScopeId";
import "./worldsFair";

describe("worldEvents.worldsFair — simple host flavor event (Phase 3, rewritten)", () => {
  let db: MockDb;
  const scopeId = countryScopeId("JP");

  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
  });

  it("registers a single default no-decision option — no bidding, no escrow", () => {
    const handler = getEventHandler("worldEvents.worldsFair");
    expect(handler).toBeDefined();
    expect(handler!.options).toHaveLength(1);
    expect(handler!.defaultOptionId).toBe("acknowledge");
    expect(handler!.options[0]!.isDefault).toBe(true);
  });

  it("full offer → resolve flow applies a smaller approval bump + one sector demand bump, cheaper than Olympics", async () => {
    db.collection("eventInstances");
    db.collection("governmentApprovals");
    db.collection("eventCooldownLedger");
    db.collection("countryModifiers");

    db.collectionMocks.eventInstances!.findOne.mockResolvedValueOnce(null);

    const offered = await offerEvent(db as never, {
      kind: "worldEvents.worldsFair",
      scope: "country",
      scopeId,
      definitionVersion: 1,
      roll: 50,
      payload: { countryId: "JP" },
      offeredAtTurn: 100,
      expiresAtRealtimeMs: Date.now() + 60_000,
    });

    db.collectionMocks.eventInstances!.findOne.mockResolvedValue({ ...offered, status: "pending" });
    db.collectionMocks.eventInstances!.findOneAndUpdate.mockResolvedValue({
      ...offered,
      status: "resolved",
      resolvedOptionId: "acknowledge",
      resolvedTierLabel: "A well-attended World's Fair",
    });

    await resolveEvent(db as never, offered._id, "acknowledge", "player", 100);

    expect(db.collectionMocks.governmentApprovals!.updateOne).toHaveBeenCalledWith(
      { _id: "JP" },
      { $inc: { approvalRating: 3 } }
    );

    expect(db.collectionMocks.countryModifiers!.insertOne).toHaveBeenCalledTimes(1);
    const doc = db.collectionMocks.countryModifiers!.insertOne.mock.calls[0][0];
    expect(doc.countryId).toBe("JP");
    expect(doc.sectorType).toBe("technology");
    expect(doc.pct).toBe(5);
    expect(doc.expiresAtTurn).toBe(106);
  });
});
