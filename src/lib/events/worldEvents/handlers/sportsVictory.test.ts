import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import {
  _resetEventHandlerRegistryForTests,
  getEventHandler,
} from "@/lib/events/substrate/registry";
import { offerEvent, hasPendingEvent } from "@/lib/events/substrate/offer";
import { resolveEvent } from "@/lib/events/substrate/resolve";
import { countryScopeId } from "@/lib/events/substrate/countryScopeId";
import "./sportsVictory";

describe("worldEvents.sportsVictory — offer → resolve → effects (Phase 0 proof-of-spine)", () => {
  let db: MockDb;
  const scopeId = countryScopeId("US");

  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
  });

  it("registers a single default no-decision option", () => {
    const handler = getEventHandler("worldEvents.sportsVictory");
    expect(handler).toBeDefined();
    expect(handler!.options).toHaveLength(1);
    expect(handler!.defaultOptionId).toBe("acknowledge");
    expect(handler!.options[0]!.isDefault).toBe(true);
  });

  it("hasPendingEvent keys on (scope, scopeId) — one pending event per COUNTRY, not globally", async () => {
    db.collection("eventInstances");
    db.collectionMocks.eventInstances!.findOne.mockResolvedValueOnce(null);
    expect(await hasPendingEvent(db as never, "country", scopeId)).toBe(false);

    db.collectionMocks.eventInstances!.findOne.mockResolvedValueOnce({ _id: new ObjectId() });
    expect(await hasPendingEvent(db as never, "country", scopeId)).toBe(true);
  });

  it("full offer → resolve flow applies approvalDelta + treasuryDelta + wire, ledger-conserving", async () => {
    db.collection("eventInstances");
    db.collection("federalBudget");
    db.collection("financialTxLog");
    db.collection("governmentApprovals");
    db.collection("eventCooldownLedger");

    db.collectionMocks.eventInstances!.findOne.mockResolvedValueOnce(null); // offer-time conflict check
    db.collectionMocks.federalBudget!.findOne.mockResolvedValue({
      countryId: "US",
      treasuryBalance: 1_000_000,
    });

    const offered = await offerEvent(db as never, {
      kind: "worldEvents.sportsVictory",
      scope: "country",
      scopeId,
      definitionVersion: 1,
      roll: 55,
      payload: { countryId: "US" },
      offeredAtTurn: 100,
      expiresAtRealtimeMs: Date.now() + 60_000,
    });

    db.collectionMocks.eventInstances!.findOne.mockResolvedValue({
      ...offered,
      status: "pending",
    });
    db.collectionMocks.eventInstances!.findOneAndUpdate.mockResolvedValue({
      ...offered,
      status: "resolved",
      resolvedOptionId: "acknowledge",
      resolvedTierLabel: "A moment of national pride",
    });

    await resolveEvent(db as never, offered._id, "acknowledge", "player", 100);

    // approvalDelta
    expect(db.collectionMocks.governmentApprovals!.updateOne).toHaveBeenCalledWith(
      { _id: "US" },
      { $inc: { approvalRating: 2 } }
    );
    // treasuryDelta moved the treasury and logged a conservation-tracked tx row.
    expect(db.collectionMocks.federalBudget!.updateOne).toHaveBeenCalledWith(
      { countryId: "US" },
      expect.objectContaining({ $set: expect.objectContaining({ treasuryBalance: 1_005_000 }) })
    );
    expect(db.collectionMocks.financialTxLog!.insertOne).toHaveBeenCalledTimes(1);
    const txDoc = db.collectionMocks.financialTxLog!.insertOne.mock.calls[0][0];
    expect(txDoc.type).toBe("world_event_payout");
    expect(txDoc.amount).toBe(5_000);
    // Country cooldown ledger updated (scope "country", not "character").
    expect(db.collectionMocks.eventCooldownLedger!.updateOne).toHaveBeenCalledWith(
      { scope: "country", scopeId },
      expect.objectContaining({ $set: expect.objectContaining({ scope: "country" }) }),
      { upsert: true }
    );
  });
});
