import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId } from "mongodb";
import type { Db } from "mongodb";
import type { EventInstance, OutcomeTier } from "@/lib/db/types/events";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

const createSystemNewsPost = vi.fn();
vi.mock("@/lib/news", () => ({
  createSystemNewsPost: (...args: unknown[]) => createSystemNewsPost(...args),
}));

const scopeId = new ObjectId();

function instance(payload: Record<string, unknown> = {}): EventInstance {
  return {
    _id: new ObjectId(),
    kind: "pree.uk.cmaProbe",
    scope: "character",
    scopeId,
    definitionVersion: 1,
    status: "resolved",
    roll: 10,
    payload,
    offeredAtTurn: 1,
    offeredAt: new Date(0),
    expiresAtRealtimeMs: 0,
    createdAt: new Date(0),
    updatedAt: new Date(0),
  };
}

describe("emitOutcomeNewsWire", () => {
  let db: MockDb;

  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
    db.collection("characters");
    db.collectionMocks.characters!.findOne.mockResolvedValue({
      _id: scopeId,
      name: "Jane Director",
      countryId: "UK",
    });
  });

  it("does nothing for a tier without a newsWire", async () => {
    const { emitOutcomeNewsWire } = await import("./outcomeNews");
    const tier: OutcomeTier = { minRoll: 1, maxRoll: 39, label: "Quiet", effects: [] };
    await emitOutcomeNewsWire(db as unknown as Db, instance(), tier);
    expect(createSystemNewsPost).not.toHaveBeenCalled();
  });

  it("posts an interpolated wire story for a tagged tier", async () => {
    const { emitOutcomeNewsWire } = await import("./outcomeNews");
    const tier: OutcomeTier = {
      minRoll: 1,
      maxRoll: 39,
      label: "Record fine",
      effects: [],
      newsWire: {
        category: "general",
        title: "CMA fines {corp}",
        template: "{name}, CEO of {corp} in the {country}, lost the fight.",
      },
    };
    await emitOutcomeNewsWire(db as unknown as Db, instance({ corpName: "Acme PLC" }), tier);

    expect(createSystemNewsPost).toHaveBeenCalledTimes(1);
    const [content, category, opts] = createSystemNewsPost.mock.calls[0]!;
    expect(content).toBe("Jane Director, CEO of Acme PLC in the United Kingdom, lost the fight.");
    expect(category).toBe("general");
    expect(opts).toEqual({ title: "CMA fines Acme PLC" });
  });
});
