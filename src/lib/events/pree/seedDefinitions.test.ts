import { describe, expect, it } from "vitest";
import { createMockDb } from "@/lib/test-utils/mockDb";
import { getEventHandler } from "@/lib/events/substrate/registry";
import { PREE_SEED_DEFINITIONS, seedPreeEventDefinitions } from "./seedDefinitions";
import "@/lib/events/pree/index";

describe("PREE seed catalog", () => {
  it("has a unique kind per definition", () => {
    const kinds = PREE_SEED_DEFINITIONS.map((d) => d.kind);
    expect(new Set(kinds).size).toBe(kinds.length);
  });

  it("every seed definition matches its registered handler", () => {
    for (const def of PREE_SEED_DEFINITIONS) {
      const handler = getEventHandler(def.kind);
      expect(handler, `missing handler for ${def.kind}`).toBeDefined();

      const handlerIds = handler!.options.map((o) => o.id).sort();
      const defIds = def.options.map((o) => o.id).sort();
      expect(defIds, `option ids drifted for ${def.kind}`).toEqual(handlerIds);

      expect(def.defaultOptionId, `default drifted for ${def.kind}`).toBe(handler!.defaultOptionId);
      expect(
        def.options.find((o) => o.id === def.defaultOptionId)?.isDefault,
        `default option not flagged for ${def.kind}`
      ).toBe(true);

      expect(def.eligibility.length, `no eligibility tags for ${def.kind}`).toBeGreaterThan(0);
      expect(def.baseWeight, `non-positive weight for ${def.kind}`).toBeGreaterThan(0);
    }
  });

  it("covers every eligibility role so all player types can receive events", () => {
    const tags = new Set(PREE_SEED_DEFINITIONS.flatMap((d) => d.eligibility));
    expect(tags).toContain("all");
    expect(tags).toContain("politician");
    expect(tags).toContain("inElection");
    expect(tags).toContain("ceo");
  });

  it("year windows (era gating) are sane", () => {
    for (const def of PREE_SEED_DEFINITIONS) {
      if (def.minYear != null) {
        expect(def.minYear, `minYear out of range for ${def.kind}`).toBeGreaterThanOrEqual(1900);
        expect(def.minYear, `minYear out of range for ${def.kind}`).toBeLessThanOrEqual(2100);
      }
      if (def.maxYear != null) {
        expect(def.maxYear, `maxYear out of range for ${def.kind}`).toBeGreaterThanOrEqual(1900);
        expect(def.maxYear, `maxYear out of range for ${def.kind}`).toBeLessThanOrEqual(2100);
      }
      if (def.minYear != null && def.maxYear != null) {
        expect(def.minYear, `minYear > maxYear for ${def.kind}`).toBeLessThanOrEqual(def.maxYear);
      }
    }
  });

  it("decade events are bounded to exactly their decade", () => {
    const decadeDefs = PREE_SEED_DEFINITIONS.filter((d) => d.kind.startsWith("pree.decade."));
    expect(decadeDefs.length).toBeGreaterThan(0);
    for (const def of decadeDefs) {
      expect(def.minYear, `${def.kind} missing minYear`).toBeDefined();
      expect(def.maxYear, `${def.kind} missing maxYear`).toBeDefined();
      expect(def.minYear! % 10, `${def.kind} minYear not a decade start`).toBe(0);
      expect(def.maxYear! - def.minYear!, `${def.kind} window is not one decade`).toBe(9);
    }
  });

  it("re-seeding never overwrites status or version on existing rows", async () => {
    const db = createMockDb();
    db.collection("eventDefinitions");
    db.collectionMocks.eventDefinitions!.updateOne.mockResolvedValue({
      matchedCount: 1,
      modifiedCount: 1,
      upsertedCount: 0,
    });

    await seedPreeEventDefinitions(db as never);

    expect(db.collectionMocks.eventDefinitions!.updateOne).toHaveBeenCalledTimes(
      PREE_SEED_DEFINITIONS.length
    );
    for (const call of db.collectionMocks.eventDefinitions!.updateOne.mock.calls) {
      const update = call[1] as {
        $set: Record<string, unknown>;
        $setOnInsert: Record<string, unknown>;
      };
      expect(update.$set).not.toHaveProperty("status");
      expect(update.$set).not.toHaveProperty("version");
      expect(update.$setOnInsert.status).toBe("draft");
      expect(update.$setOnInsert.version).toBe(1);
    }
  });

  it("counts only newly inserted definitions as upserted", async () => {
    const db = createMockDb();
    db.collection("eventDefinitions");
    const updateOne = db.collectionMocks.eventDefinitions!.updateOne;
    updateOne
      .mockResolvedValue({ matchedCount: 1, modifiedCount: 1, upsertedCount: 0 })
      .mockResolvedValueOnce({ matchedCount: 0, modifiedCount: 0, upsertedCount: 1 });

    const result = await seedPreeEventDefinitions(db as never);
    expect(result.upserted).toBe(1);
  });
});
