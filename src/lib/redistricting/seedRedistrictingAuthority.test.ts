import { describe, it, expect } from "vitest";
import type { Db } from "mongodb";
import { createMockDb, bulkOps } from "@/lib/test-utils/mockDb";
import {
  seedRedistrictingAuthority,
  legislativeAuthorityPolicy,
  AUTHORITY_LEGISLATIVE_INDEX,
  AUTHORITY_LEGISLATIVE_OPTION_ID,
} from "./seedRedistrictingAuthority";
import { REDISTRICT_AUTHORITY_LAW } from "./caps";

const NOW = new Date("1960-01-01T00:00:00.000Z");

describe("legislativeAuthorityPolicy", () => {
  it("is the legislature-drawn option (index 2, canDraw)", () => {
    const p = legislativeAuthorityPolicy("OH", NOW);
    expect(p.legislationTypeId).toBe(REDISTRICT_AUTHORITY_LAW);
    expect(p.policyOptionIndex).toBe(AUTHORITY_LEGISLATIVE_INDEX);
    expect(p.policyOptionIndex).toBe(2);
    expect(p.policyOptionId).toBe(AUTHORITY_LEGISLATIVE_OPTION_ID);
    expect(p.scope).toBe("state");
    expect(p.stateId).toBe("OH");
    expect(p.effectDirection).toBe(-1);
  });
});

describe("seedRedistrictingAuthority", () => {
  it("writes one legislature-drawn upsert per state", async () => {
    const db = createMockDb();
    await seedRedistrictingAuthority(db as unknown as Db, {
      stateIds: ["OH", "CA"],
      now: NOW,
    });
    const ops = bulkOps(db.collectionMocks.statePolicies!.bulkWrite);
    expect(ops).toHaveLength(2);
    for (const [filter, update] of ops) {
      expect(filter.legislationTypeId).toBe(REDISTRICT_AUTHORITY_LAW);
      const seed = (update.$setOnInsert ?? {}) as Record<string, unknown>;
      // Non-clobbering: only $setOnInsert, never $set.
      expect(update.$set).toBeUndefined();
      expect(seed.policyOptionIndex).toBe(2);
    }
    expect(ops.map(([f]) => f.stateId).sort()).toEqual(["CA", "OH"]);
  });

  it("dedupes repeated stateIds", async () => {
    const db = createMockDb();
    await seedRedistrictingAuthority(db as unknown as Db, {
      stateIds: ["OH", "OH", "TX"],
      now: NOW,
    });
    const ops = bulkOps(db.collectionMocks.statePolicies!.bulkWrite);
    expect(ops.map(([f]) => f.stateId).sort()).toEqual(["OH", "TX"]);
  });

  it("no-ops on an empty state list", async () => {
    const db = createMockDb();
    db.collection("statePolicies");
    const res = await seedRedistrictingAuthority(db as unknown as Db, {
      stateIds: [],
      now: NOW,
    });
    expect(res.seeded).toBe(0);
    expect(db.collectionMocks.statePolicies!.bulkWrite).not.toHaveBeenCalled();
  });
});
