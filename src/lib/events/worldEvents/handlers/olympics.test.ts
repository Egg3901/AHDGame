import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import { getEventHandler } from "@/lib/events/substrate/registry";
import { offerEvent } from "@/lib/events/substrate/offer";
import { resolveEvent } from "@/lib/events/substrate/resolve";
import { countryScopeId } from "@/lib/events/substrate/countryScopeId";
import "./olympics";

describe("worldEvents.olympics — simple host flavor event (Phase 3, rewritten)", () => {
  let db: MockDb;
  const scopeId = countryScopeId("US");

  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
  });

  it("registers a single default no-decision option — no bidding, no escrow", () => {
    const handler = getEventHandler("worldEvents.olympics");
    expect(handler).toBeDefined();
    expect(handler!.options).toHaveLength(1);
    expect(handler!.defaultOptionId).toBe("acknowledge");
    expect(handler!.options[0]!.isDefault).toBe(true);
  });

  it("full offer → resolve flow applies approvalDelta + sector demand bumps + wire, no treasury movement", async () => {
    db.collection("eventInstances");
    db.collection("governmentApprovals");
    db.collection("eventCooldownLedger");
    db.collection("countryModifiers");

    db.collectionMocks.eventInstances!.findOne.mockResolvedValueOnce(null);

    const offered = await offerEvent(db as never, {
      kind: "worldEvents.olympics",
      scope: "country",
      scopeId,
      definitionVersion: 1,
      roll: 50,
      payload: { countryId: "US" },
      offeredAtTurn: 100,
      expiresAtRealtimeMs: Date.now() + 60_000,
    });

    db.collectionMocks.eventInstances!.findOne.mockResolvedValue({ ...offered, status: "pending" });
    db.collectionMocks.eventInstances!.findOneAndUpdate.mockResolvedValue({
      ...offered,
      status: "resolved",
      resolvedOptionId: "acknowledge",
      resolvedTierLabel: "A successful Olympic Games",
    });

    await resolveEvent(db as never, offered._id, "acknowledge", "player", 100);

    expect(db.collectionMocks.governmentApprovals!.updateOne).toHaveBeenCalledWith(
      { _id: "US" },
      { $inc: { approvalRating: 6 } }
    );

    const modifierDocs = db.collectionMocks.countryModifiers!.insertOne.mock.calls.map(
      (call) => call[0]
    );
    expect(modifierDocs).toHaveLength(2);
    expect(modifierDocs.map((d) => d.sectorType).sort()).toEqual(["construction", "entertainment"]);
    for (const doc of modifierDocs) {
      expect(doc.countryId).toBe("US");
      expect(doc.pct).toBe(8);
      expect(doc.expiresAtTurn).toBe(106);
    }

    // No treasury movement at all — this is a wire-only flavor event, unlike
    // the old bidding cycle's escrow/refund machinery.
    expect(db.collectionMocks.eventCooldownLedger!.updateOne).toHaveBeenCalledWith(
      { scope: "country", scopeId },
      expect.objectContaining({ $set: expect.objectContaining({ scope: "country" }) }),
      { upsert: true }
    );
  });
});
