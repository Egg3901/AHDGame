import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import { getEventHandler, getDefaultOptionId } from "@/lib/events/substrate/registry";
import { offerEvent } from "@/lib/events/substrate/offer";
import { resolveEvent } from "@/lib/events/substrate/resolve";
import { sweepExpired } from "@/lib/events/substrate/sweep";
import { countryScopeId } from "@/lib/events/substrate/countryScopeId";
import "./scientificBreakthrough";

describe("worldEvents.scientificBreakthrough — Phase 2 executive decision event", () => {
  let db: MockDb;
  const scopeId = countryScopeId("US");

  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
    db.collection("eventInstances");
    db.collection("federalBudget");
    db.collection("financialTxLog");
    db.collection("governmentApprovals");
    db.collection("eventCooldownLedger");
    db.collection("countryModifiers");
  });

  it("registers two options with 'decline' as the safe/free default", () => {
    const handler = getEventHandler("worldEvents.scientificBreakthrough");
    expect(handler).toBeDefined();
    expect(handler!.options.map((o) => o.id).sort()).toEqual(["decline", "fund"]);
    expect(handler!.defaultOptionId).toBe("decline");
    expect(getDefaultOptionId("worldEvents.scientificBreakthrough")).toBe("decline");
  });

  it("'fund' costs the treasury, writes a conserving financialTxLog row, and boosts tech demand", async () => {
    db.collectionMocks.eventInstances!.findOne.mockResolvedValueOnce(null);
    db.collectionMocks.federalBudget!.findOne.mockResolvedValue({
      countryId: "US",
      treasuryBalance: 1_000_000,
    });

    const offered = await offerEvent(db as never, {
      kind: "worldEvents.scientificBreakthrough",
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
      resolvedOptionId: "fund",
    });

    await resolveEvent(db as never, offered._id, "fund", "player", 100);

    expect(db.collectionMocks.governmentApprovals!.updateOne).toHaveBeenCalledWith(
      { _id: "US" },
      { $inc: { approvalRating: 2 } }
    );
    expect(db.collectionMocks.federalBudget!.updateOne).toHaveBeenCalledWith(
      { countryId: "US" },
      expect.objectContaining({ $set: expect.objectContaining({ treasuryBalance: 980_000 }) })
    );
    const txDoc = db.collectionMocks.financialTxLog!.insertOne.mock.calls[0][0];
    expect(txDoc.type).toBe("world_event_payout");
    expect(txDoc.amount).toBe(-20_000);
    // durationTurns isn't a stored field on CountryModifier — it's converted to
    // expiresAtTurn (appliedAtTurn + durationTurns) by writeSectorDemandModifier.
    expect(db.collectionMocks.countryModifiers!.insertOne).toHaveBeenCalledWith(
      expect.objectContaining({ sectorType: "technology", pct: 6, expiresAtTurn: 108 })
    );
  });

  it("'decline' is free — no treasury or ledger writes", async () => {
    db.collectionMocks.eventInstances!.findOne.mockResolvedValueOnce(null);
    const offered = await offerEvent(db as never, {
      kind: "worldEvents.scientificBreakthrough",
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
      resolvedOptionId: "decline",
    });

    await resolveEvent(db as never, offered._id, "decline", "player", 100);

    expect(db.collectionMocks.federalBudget!.updateOne).not.toHaveBeenCalled();
    expect(db.collectionMocks.financialTxLog!.insertOne).not.toHaveBeenCalled();
    expect(db.collectionMocks.governmentApprovals!.updateOne).not.toHaveBeenCalled();
    expect(db.collectionMocks.countryModifiers!.insertOne).not.toHaveBeenCalled();
  });

  it("vacant-executive timeout sweeps to the safe 'decline' default — never funds, never treasury-negative", async () => {
    const offered = {
      _id: new ObjectId(),
      kind: "worldEvents.scientificBreakthrough",
      scope: "country" as const,
      scopeId,
      definitionVersion: 1,
      status: "pending" as const,
      roll: 50,
      payload: { countryId: "US" },
      offeredAtTurn: 90,
      offeredAt: new Date(),
      expiresAtRealtimeMs: Date.now() - 1_000,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    db.collectionMocks.eventInstances!.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([offered]),
    });
    db.collectionMocks.eventInstances!.findOne.mockResolvedValue(offered);
    db.collectionMocks.eventInstances!.findOneAndUpdate.mockResolvedValue({
      ...offered,
      status: "expired",
      resolvedOptionId: "decline",
      resolveReason: "timeout",
    });

    const result = await sweepExpired(db as never, 100);

    expect(result.skipped).toEqual([]);
    expect(result.swept[0]!.resolvedOptionId).toBe("decline");
    expect(db.collectionMocks.federalBudget!.updateOne).not.toHaveBeenCalled();
  });
});
