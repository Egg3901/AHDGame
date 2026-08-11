import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import type { EventInstance } from "@/lib/db/types/events";
import { registerEventHandler, _resetEventHandlerRegistryForTests } from "./registry";
import { sweepExpired } from "./sweep";
import { applyDeclarativeEffects } from "./applyEffects";

/**
 * Country-scope vacant-executive timeout safety (plan §7): a decision event's
 * default option must never be treasury-negative, so a vacant office (nobody
 * to decide, nobody to notify) still resolves safely at the response-window
 * timeout via the existing sweep — no special-casing needed for "no decider".
 */
describe("country-scope timeout — vacant executive resolves to a safe default", () => {
  let db: MockDb;
  const scopeId = new ObjectId();

  beforeEach(() => {
    vi.clearAllMocks();
    _resetEventHandlerRegistryForTests();
    db = createMockDb();

    registerEventHandler({
      kind: "worldEvents.testDecision",
      defaultOptionId: "decline",
      options: [
        {
          id: "fund",
          label: "Fund it",
          description: "Costs the treasury.",
          outcomeTable: [
            {
              minRoll: 1,
              maxRoll: 100,
              label: "Funded",
              effects: [{ type: "treasuryDelta", deltaAnchor: -10_000 }],
            },
          ],
        },
        {
          id: "decline",
          label: "Decline",
          description: "Safe default — no cost.",
          isDefault: true,
          outcomeTable: [
            {
              minRoll: 1,
              maxRoll: 100,
              label: "Declined",
              effects: [{ type: "approvalDelta", delta: -1 }, { type: "wireOnly" }],
            },
          ],
        },
      ],
      applyEffects: async (ctx) => {
        await applyDeclarativeEffects(ctx, ctx.tier.effects);
      },
    });
  });

  it("sweepExpired resolves an unresolved country instance to the safe default option, never the costly one", async () => {
    const instanceId = new ObjectId();
    const expiredInstance: EventInstance = {
      _id: instanceId,
      kind: "worldEvents.testDecision",
      scope: "country",
      scopeId,
      definitionVersion: 1,
      status: "pending",
      roll: 10,
      payload: { countryId: "US" },
      offeredAtTurn: 90,
      offeredAt: new Date(Date.now() - 86_400_000),
      expiresAtRealtimeMs: Date.now() - 1,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    db.collection("eventInstances");
    db.collection("governmentApprovals");
    db.collection("federalBudget");
    db.collection("financialTxLog");
    db.collectionMocks.eventInstances!.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([expiredInstance]),
    });
    db.collectionMocks.eventInstances!.findOne.mockResolvedValue(expiredInstance);
    db.collectionMocks.eventInstances!.findOneAndUpdate.mockResolvedValue({
      ...expiredInstance,
      status: "expired",
      resolvedOptionId: "decline",
      resolvedTierLabel: "Declined",
    });

    const result = await sweepExpired(db as never, 100);

    expect(result.swept).toHaveLength(1);
    expect(result.swept[0]!.resolvedOptionId).toBe("decline");
    // The costly option's effect must never fire on a timeout default.
    expect(db.collectionMocks.federalBudget!.updateOne).not.toHaveBeenCalled();
    expect(db.collectionMocks.financialTxLog!.insertOne).not.toHaveBeenCalled();
    // The safe default's own effect still applied.
    expect(db.collectionMocks.governmentApprovals!.updateOne).toHaveBeenCalledWith(
      { _id: "US" },
      { $inc: { approvalRating: -1 } }
    );
  });
});
