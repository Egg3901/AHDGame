import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import type { EventInstance, OutcomeTier } from "@/lib/db/types/events";
import { applyDeclarativeEffects } from "./applyEffects";
import type { EventHandlerOption, EventResolveContext } from "./types";

function makeInstance(overrides: Partial<EventInstance> = {}): EventInstance {
  return {
    _id: new ObjectId(),
    kind: "worldEvents.sportsVictory",
    scope: "country",
    scopeId: new ObjectId(),
    definitionVersion: 1,
    status: "pending",
    roll: 50,
    payload: { countryId: "US" },
    offeredAtTurn: 100,
    offeredAt: new Date(),
    expiresAtRealtimeMs: Date.now() + 60_000,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function makeCtx(db: MockDb, instance: EventInstance, tier: OutcomeTier): EventResolveContext {
  const option: EventHandlerOption = {
    id: "acknowledge",
    label: "Acknowledge",
    description: "",
    isDefault: true,
    outcomeTable: [tier],
  };
  return {
    db: db as never,
    currentTurn: 100,
    instance,
    option,
    tier,
    reason: "player",
  };
}

describe("applyDeclarativeEffects — country scope (World Events v1 Phase 0)", () => {
  let db: MockDb;

  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
  });

  it("treasuryDelta credits the treasury via creditTreasury and writes a financialTxLog entry (ledger conservation)", async () => {
    db.collection("federalBudget");
    db.collectionMocks.federalBudget!.findOne.mockResolvedValue({
      countryId: "US",
      treasuryBalance: 1_000_000,
    });
    db.collection("financialTxLog");

    const instance = makeInstance();
    const tier: OutcomeTier = {
      minRoll: 1,
      maxRoll: 100,
      label: "win",
      effects: [{ type: "treasuryDelta", deltaAnchor: 5_000 }],
    };
    const ctx = makeCtx(db, instance, tier);

    await applyDeclarativeEffects(ctx, tier.effects);

    // Treasury moved via the canonical mover.
    expect(db.collectionMocks.federalBudget!.updateOne).toHaveBeenCalledWith(
      { countryId: "US" },
      expect.objectContaining({ $set: expect.objectContaining({ treasuryBalance: 1_005_000 }) })
    );
    // A financialTxLog row was written for the same amount — this is what the
    // shadow ledger derives a balanced entry from (deriveFromTx.ts), so
    // conservation holds even though this test doesn't enable ledgerShadow.
    expect(db.collectionMocks.financialTxLog!.insertOne).toHaveBeenCalledTimes(1);
    const doc = db.collectionMocks.financialTxLog!.insertOne.mock.calls[0][0];
    expect(doc.type).toBe("world_event_payout");
    expect(doc.subjectType).toBe("government");
    expect(doc.countryId).toBe("US");
    expect(doc.amount).toBe(5_000);
  });

  it("treasuryDelta debits the treasury for a negative delta", async () => {
    db.collection("federalBudget");
    db.collectionMocks.federalBudget!.findOne.mockResolvedValue({
      countryId: "US",
      treasuryBalance: 1_000_000,
    });
    db.collection("financialTxLog");

    const instance = makeInstance();
    const tier: OutcomeTier = {
      minRoll: 1,
      maxRoll: 100,
      label: "aid",
      effects: [{ type: "treasuryDelta", deltaAnchor: -2_000 }],
    };
    const ctx = makeCtx(db, instance, tier);

    await applyDeclarativeEffects(ctx, tier.effects);

    expect(db.collectionMocks.federalBudget!.updateOne).toHaveBeenCalledWith(
      { countryId: "US" },
      expect.objectContaining({ $set: expect.objectContaining({ treasuryBalance: 998_000 }) })
    );
    const doc = db.collectionMocks.financialTxLog!.insertOne.mock.calls[0][0];
    expect(doc.amount).toBe(-2_000);
  });

  it("treasuryDelta of 0 is a no-op — no treasury write, no financialTxLog row", async () => {
    db.collection("federalBudget");
    db.collection("financialTxLog");

    const instance = makeInstance();
    const tier: OutcomeTier = {
      minRoll: 1,
      maxRoll: 100,
      label: "flat",
      effects: [{ type: "treasuryDelta", deltaAnchor: 0 }],
    };
    const ctx = makeCtx(db, instance, tier);

    await applyDeclarativeEffects(ctx, tier.effects);

    expect(db.collectionMocks.federalBudget!.updateOne).not.toHaveBeenCalled();
    expect(db.collectionMocks.financialTxLog!.insertOne).not.toHaveBeenCalled();
  });

  it("approvalDelta increments governmentApprovals.approvalRating for the country", async () => {
    db.collection("governmentApprovals");

    const instance = makeInstance();
    const tier: OutcomeTier = {
      minRoll: 1,
      maxRoll: 100,
      label: "pride",
      effects: [{ type: "approvalDelta", delta: 3 }],
    };
    const ctx = makeCtx(db, instance, tier);

    await applyDeclarativeEffects(ctx, tier.effects);

    expect(db.collectionMocks.governmentApprovals!.updateOne).toHaveBeenCalledWith(
      { _id: "US" },
      { $inc: { approvalRating: 3 } }
    );
  });

  it("sectorDemandModifier writes a countryModifiers doc that expires at appliedAtTurn + durationTurns", async () => {
    db.collection("countryModifiers");

    const instance = makeInstance();
    const tier: OutcomeTier = {
      minRoll: 1,
      maxRoll: 100,
      label: "boom",
      effects: [{ type: "sectorDemandModifier", sectorType: "tourism", pct: 8, durationTurns: 6 }],
    };
    const ctx = makeCtx(db, instance, tier);

    await applyDeclarativeEffects(ctx, tier.effects);

    expect(db.collectionMocks.countryModifiers!.insertOne).toHaveBeenCalledTimes(1);
    const doc = db.collectionMocks.countryModifiers!.insertOne.mock.calls[0][0];
    expect(doc.countryId).toBe("US");
    expect(doc.sectorType).toBe("tourism");
    expect(doc.pct).toBe(8);
    expect(doc.appliedAtTurn).toBe(100);
    expect(doc.expiresAtTurn).toBe(106);
  });

  it("sectorOutputDemandModifier writes an output-demand shift for seller margins", async () => {
    db.collection("countryModifiers");
    const instance = makeInstance();
    const tier: OutcomeTier = {
      minRoll: 1,
      maxRoll: 100,
      label: "mobilization",
      effects: [
        {
          type: "sectorOutputDemandModifier",
          sectorType: "defense",
          pct: 10,
          durationTurns: 8,
        },
      ],
    };

    await applyDeclarativeEffects(makeCtx(db, instance, tier), tier.effects);

    expect(db.collectionMocks.countryModifiers!.insertOne.mock.calls[0][0]).toEqual(
      expect.objectContaining({
        countryId: "US",
        kind: "sectorOutputDemandModifier",
        sectorType: "defense",
        pct: 10,
        appliedAtTurn: 100,
        expiresAtTurn: 108,
      })
    );
  });

  it("warEmergencyMitigation writes bounded domestic relief without changing global tension", async () => {
    db.collection("countryModifiers");
    const instance = makeInstance();
    const tier: OutcomeTier = {
      minRoll: 1,
      maxRoll: 100,
      label: "mobilization",
      effects: [{ type: "warEmergencyMitigation", pct: 18, durationTurns: 24 }],
    };

    await applyDeclarativeEffects(makeCtx(db, instance, tier), tier.effects);

    const doc = db.collectionMocks.countryModifiers!.insertOne.mock.calls[0][0];
    expect(doc).toEqual(
      expect.objectContaining({
        countryId: "US",
        kind: "warEmergencyMitigation",
        pct: 18,
        appliedAtTurn: 100,
        expiresAtTurn: 124,
        sourceInstanceId: instance._id,
      })
    );
    expect(db.collectionMocks.coldWarTension).toBeUndefined();
  });

  it("wireOnly is a pure no-op — no collection writes", async () => {
    const instance = makeInstance();
    const tier: OutcomeTier = {
      minRoll: 1,
      maxRoll: 100,
      label: "news",
      effects: [{ type: "wireOnly" }],
    };
    const ctx = makeCtx(db, instance, tier);

    await expect(applyDeclarativeEffects(ctx, tier.effects)).resolves.toBeUndefined();
  });

  it("throws when a country-scope instance is missing payload.countryId", async () => {
    const instance = makeInstance({ payload: {} });
    const tier: OutcomeTier = {
      minRoll: 1,
      maxRoll: 100,
      label: "x",
      effects: [{ type: "wireOnly" }],
    };
    const ctx = makeCtx(db, instance, tier);

    await expect(applyDeclarativeEffects(ctx, tier.effects)).rejects.toThrow(/payload.countryId/);
  });

  it("rejects a character-only effect type reaching country scope", async () => {
    const instance = makeInstance();
    const tier: OutcomeTier = {
      minRoll: 1,
      maxRoll: 100,
      label: "x",
      effects: [{ type: "favorability", delta: 5 }],
    };
    const ctx = makeCtx(db, instance, tier);

    await expect(applyDeclarativeEffects(ctx, tier.effects)).rejects.toThrow(
      /not valid for country scope/
    );
  });
});
