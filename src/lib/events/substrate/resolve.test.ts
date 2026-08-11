import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import type { EventInstance } from "@/lib/db/types/events";
import { registerEventHandler, _resetEventHandlerRegistryForTests } from "./registry";
import { offerEvent } from "./offer";
import { resolveEvent } from "./resolve";
import { sweepExpired } from "./sweep";

function makeHandler(applySpy = vi.fn().mockResolvedValue(undefined)) {
  registerEventHandler({
    kind: "pree.test",
    defaultOptionId: "ignore",
    options: [
      {
        id: "act",
        label: "Act",
        description: "Take action",
        outcomeTable: [
          {
            minRoll: 1,
            maxRoll: 39,
            label: "poor",
            effects: [{ type: "favorability", delta: -5 }],
          },
          {
            minRoll: 40,
            maxRoll: 100,
            label: "fine",
            effects: [{ type: "favorability", delta: 2 }],
          },
        ],
      },
      {
        id: "ignore",
        label: "Ignore",
        description: "Default",
        isDefault: true,
        outcomeTable: [
          {
            minRoll: 1,
            maxRoll: 100,
            label: "ignored",
            effects: [{ type: "favorability", delta: -1 }],
          },
        ],
      },
    ],
    applyEffects: applySpy,
  });
}

function touchEventCollections(db: MockDb) {
  db.collection("eventInstances");
  db.collection("eventCooldownLedger");
  return {
    instances: db.collectionMocks.eventInstances!,
    ledger: db.collectionMocks.eventCooldownLedger!,
  };
}

describe("event substrate resolve + sweep", () => {
  let db: MockDb;
  const scopeId = new ObjectId();

  beforeEach(() => {
    _resetEventHandlerRegistryForTests();
    db = createMockDb();
  });

  it("resolveEvent applies handler effects and marks instance resolved", async () => {
    const applySpy = vi.fn().mockResolvedValue(undefined);
    makeHandler(applySpy);

    const { instances } = touchEventCollections(db);
    instances.findOne.mockResolvedValueOnce(null).mockResolvedValueOnce({
      _id: new ObjectId(),
      kind: "pree.test",
      scope: "character",
      scopeId,
      status: "pending",
      roll: 80,
    } as EventInstance);

    const offered = await offerEvent(db as never, {
      kind: "pree.test",
      scope: "character",
      scopeId,
      definitionVersion: 1,
      roll: 80,
      payload: {},
      offeredAtTurn: 10,
      expiresAtRealtimeMs: Date.now() + 60_000,
    });

    instances.findOne.mockResolvedValue({
      ...offered,
      status: "pending",
      roll: 80,
    });
    instances.findOneAndUpdate.mockResolvedValue({
      ...offered,
      status: "resolved",
      resolvedOptionId: "act",
      resolvedTierLabel: "fine",
    });

    await resolveEvent(db as never, offered._id, "act", "player", 10);

    expect(applySpy).toHaveBeenCalledTimes(1);
    expect(instances.findOneAndUpdate).toHaveBeenCalled();
  });

  it("sweepExpired resolves timed-out instances with the default option", async () => {
    const applySpy = vi.fn().mockResolvedValue(undefined);
    makeHandler(applySpy);

    const instanceId = new ObjectId();
    const expiredInstance: EventInstance = {
      _id: instanceId,
      kind: "pree.test",
      scope: "character",
      scopeId,
      definitionVersion: 1,
      status: "pending",
      roll: 10,
      payload: {},
      offeredAtTurn: 5,
      offeredAt: new Date(Date.now() - 86_400_000),
      expiresAtRealtimeMs: Date.now() - 1,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const { instances } = touchEventCollections(db);
    instances.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([expiredInstance]),
    });
    instances.findOne.mockResolvedValue(expiredInstance);
    instances.findOneAndUpdate.mockResolvedValue({
      ...expiredInstance,
      status: "expired",
      resolvedOptionId: "ignore",
      resolvedTierLabel: "ignored",
    });

    const result = await sweepExpired(db as never, 10);

    expect(result.swept).toHaveLength(1);
    expect(applySpy).toHaveBeenCalledTimes(1);
  });
});
