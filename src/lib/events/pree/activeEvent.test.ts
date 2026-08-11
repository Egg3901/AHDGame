import { beforeEach, describe, expect, it } from "vitest";
import { ObjectId } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import type { EventDefinition, EventInstance } from "@/lib/db/types/events";
import { registerEventHandler } from "@/lib/events/substrate/registry";
import {
  buildActiveEventForCharacter,
  buildLastResolvedForCharacter,
  interpolateEventText,
} from "./activeEvent";

const FULL_TABLE = [
  {
    minRoll: 1,
    maxRoll: 100,
    label: "ok",
    effects: [{ type: "favorability" as const, delta: 2 }],
  },
];

registerEventHandler({
  kind: "pree.activeEventTest",
  defaultOptionId: "ignore",
  options: [
    {
      id: "act",
      label: "Handler act label",
      description: "Handler act desc",
      outcomeTable: FULL_TABLE,
    },
    {
      id: "ignore",
      label: "Handler ignore label",
      description: "Handler ignore desc",
      isDefault: true,
      outcomeTable: FULL_TABLE,
    },
  ],
});

function pendingInstance(characterId: ObjectId, expiresAtRealtimeMs: number): EventInstance {
  return {
    _id: new ObjectId(),
    kind: "pree.activeEventTest",
    scope: "character",
    scopeId: characterId,
    definitionVersion: 1,
    status: "pending",
    roll: 50,
    payload: {},
    offeredAtTurn: 8,
    offeredAt: new Date(),
    expiresAtRealtimeMs,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function definitionRow(): EventDefinition {
  return {
    _id: new ObjectId(),
    kind: "pree.activeEventTest",
    status: "approved",
    version: 1,
    title: "Definition Title",
    headline: "Definition headline",
    body: "Definition body",
    eligibility: ["all"],
    baseWeight: 10,
    cooldownTurnsMin: 0,
    cooldownTurnsMax: 0,
    defaultOptionId: "ignore",
    options: [{ id: "act", label: "Definition act label", description: "Definition act desc" }],
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

describe("buildActiveEventForCharacter", () => {
  let db: MockDb;
  const characterId = new ObjectId();
  const now = 1_000_000;

  beforeEach(() => {
    db = createMockDb();
    db.collection("eventInstances");
    db.collection("eventDefinitions");
  });

  it("returns null when there is no pending instance", async () => {
    db.collectionMocks.eventInstances!.findOne.mockResolvedValue(null);
    const dto = await buildActiveEventForCharacter(db as never, characterId, now);
    expect(dto).toBeNull();
  });

  it("returns null for an expired-but-unswept instance", async () => {
    db.collectionMocks.eventInstances!.findOne.mockResolvedValue(
      pendingInstance(characterId, now - 1)
    );
    const dto = await buildActiveEventForCharacter(db as never, characterId, now);
    expect(dto).toBeNull();
  });

  it("merges definition display copy over handler options without exposing outcome tables", async () => {
    const instance = pendingInstance(characterId, now + 60_000);
    db.collectionMocks.eventInstances!.findOne.mockResolvedValue(instance);
    db.collectionMocks.eventDefinitions!.findOne.mockResolvedValue(definitionRow());

    const dto = await buildActiveEventForCharacter(db as never, characterId, now);

    expect(dto).not.toBeNull();
    expect(dto!.instanceId).toBe(instance._id.toHexString());
    expect(dto!.title).toBe("Definition Title");
    expect(dto!.defaultOptionId).toBe("ignore");
    // Definition copy wins where present; handler copy is the fallback.
    expect(dto!.options).toEqual([
      {
        id: "act",
        label: "Definition act label",
        description: "Definition act desc",
        isDefault: false,
      },
      {
        id: "ignore",
        label: "Handler ignore label",
        description: "Handler ignore desc",
        isDefault: true,
      },
    ]);
    const serialized = JSON.stringify(dto);
    expect(serialized).not.toContain("outcomeTable");
    expect(serialized).not.toContain("minRoll");
  });

  it("falls back to handler copy when the definition row is missing", async () => {
    db.collectionMocks.eventInstances!.findOne.mockResolvedValue(
      pendingInstance(characterId, now + 60_000)
    );
    db.collectionMocks.eventDefinitions!.findOne.mockResolvedValue(null);

    const dto = await buildActiveEventForCharacter(db as never, characterId, now);

    expect(dto).not.toBeNull();
    expect(dto!.title).toBe("pree.activeEventTest");
    expect(dto!.options[0]!.label).toBe("Handler act label");
  });
});

describe("buildLastResolvedForCharacter", () => {
  let db: MockDb;
  const characterId = new ObjectId();
  const now = Date.now();

  function resolvedInstance(resolvedAt: Date): EventInstance {
    return {
      ...pendingInstance(characterId, now - 60_000),
      status: "resolved",
      resolvedAt,
      resolvedOptionId: "act",
      resolvedTierLabel: "ok",
      resolveReason: "player",
    };
  }

  beforeEach(() => {
    db = createMockDb();
    db.collection("eventInstances");
    db.collection("eventDefinitions");
  });

  it("returns null when there is no terminal instance", async () => {
    db.collectionMocks.eventInstances!.findOne.mockResolvedValue(null);
    const dto = await buildLastResolvedForCharacter(db as never, characterId, now);
    expect(dto).toBeNull();
  });

  it("returns the most recent outcome with the applied tier's effects only", async () => {
    db.collectionMocks.eventInstances!.findOne.mockResolvedValue(resolvedInstance(new Date(now)));
    db.collectionMocks.eventDefinitions!.findOne.mockResolvedValue(definitionRow());

    const dto = await buildLastResolvedForCharacter(db as never, characterId, now);

    expect(dto).not.toBeNull();
    expect(dto!.title).toBe("Definition Title");
    expect(dto!.optionLabel).toBe("Definition act label");
    expect(dto!.tierLabel).toBe("ok");
    expect(dto!.reason).toBe("player");
    expect(dto!.effects).toEqual([{ type: "favorability", delta: 2 }]);
    const serialized = JSON.stringify(dto);
    expect(serialized).not.toContain("outcomeTable");
    expect(serialized).not.toContain("minRoll");
  });

  it("hides outcomes older than the visibility window", async () => {
    const old = new Date(now - 3 * 24 * 60 * 60 * 1000);
    db.collectionMocks.eventInstances!.findOne.mockResolvedValue(resolvedInstance(old));

    const dto = await buildLastResolvedForCharacter(db as never, characterId, now);
    expect(dto).toBeNull();
  });
});

describe("interpolateEventText", () => {
  it("replaces known tokens from payload", () => {
    const result = interpolateEventText(
      "Demand: switch from {currentStrategyName} to {demandedStrategyName}",
      { currentStrategyName: "Conventional", demandedStrategyName: "Renewables Focus" }
    );
    expect(result).toBe("Demand: switch from Conventional to Renewables Focus");
  });

  it("leaves unknown tokens as-is", () => {
    expect(interpolateEventText("Hello {unknown}", {})).toBe("Hello {unknown}");
  });

  it("handles text with no tokens", () => {
    expect(interpolateEventText("No tokens here", {})).toBe("No tokens here");
  });

  it("coerces non-string payload values to strings", () => {
    expect(interpolateEventText("Count: {n}", { n: 42 })).toBe("Count: 42");
  });
});
