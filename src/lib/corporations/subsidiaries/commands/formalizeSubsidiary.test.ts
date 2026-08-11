import { describe, it, expect, vi, beforeEach } from "vitest";
import { ObjectId } from "mongodb";
import type { Db } from "mongodb";
import type { Corporation } from "@/lib/db/types";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import { formalizeSubsidiary } from "./formalizeSubsidiary";

const parentId = new ObjectId();
const targetId = new ObjectId();
const callerUserId = new ObjectId();
const otherUserId = new ObjectId();

function parentCorp(overrides: Partial<Corporation> = {}): Corporation {
  return {
    _id: parentId,
    userId: callerUserId,
    ceoVacant: false,

    ...overrides,
  } as any as Corporation;
}

function targetCorp(parentPct: number, overrides: Partial<Corporation> = {}): Corporation {
  const total = 10_000_000;
  return {
    _id: targetId,
    userId: otherUserId,
    ceoType: "character",
    totalShares: total,
    shareholders: [{ corporationId: parentId, shares: Math.round((parentPct / 100) * total) }],

    ...overrides,
  } as any as Corporation;
}

let db: MockDb;
beforeEach(() => {
  vi.clearAllMocks();
  db = createMockDb();
  // Default cycle graph: parent controls target, no back-edge.
  db.collection("corporations").find = vi.fn().mockReturnValue({
    toArray: async () => [parentCorp(), targetCorp(60)],
  });
});

const base = { callerUserId, turn: 100, now: new Date() };

describe("formalizeSubsidiary", () => {
  it("happy path: sets the formalization marker", async () => {
    const result = await formalizeSubsidiary(db as unknown as Db, {
      parent: parentCorp(),
      target: targetCorp(60),
      ...base,
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.subsidiaryFormalizedAtTurn).toBe(100);
    expect(db.collection("corporations").updateOne).toHaveBeenCalled();
  });

  it("rejects below the >50% voting threshold", async () => {
    const result = await formalizeSubsidiary(db as unknown as Db, {
      parent: parentCorp(),
      target: targetCorp(40),
      ...base,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(400);
  });

  it("rejects when the same human owns both (target operated by parent owner)", async () => {
    const result = await formalizeSubsidiary(db as unknown as Db, {
      parent: parentCorp(),
      target: targetCorp(60, { userId: callerUserId, ceoType: "character" }),
      ...base,
    });
    expect(result.ok).toBe(false);
  });

  it("rejects a national corp on either side", async () => {
    const nat = await formalizeSubsidiary(db as unknown as Db, {
      parent: parentCorp(),
      target: targetCorp(60, { countryOwnerId: "US" }),
      ...base,
    });
    expect(nat.ok).toBe(false);
    const natParent = await formalizeSubsidiary(db as unknown as Db, {
      parent: parentCorp({ countryOwnerId: "US" }),
      target: targetCorp(60),
      ...base,
    });
    expect(natParent.ok).toBe(false);
  });

  it("rejects chaining (parent is itself a formalized subsidiary)", async () => {
    const result = await formalizeSubsidiary(db as unknown as Db, {
      parent: parentCorp({ subsidiaryFormalizedAtTurn: 5 }),
      target: targetCorp(60),
      ...base,
    });
    expect(result.ok).toBe(false);
  });

  it("rejects a formalize that would create an ownership cycle", async () => {
    // Graph: parent controls target AND target controls parent.
    const total = 10_000_000;
    const parentControlledByTarget = {
      _id: parentId,
      totalShares: total,
      shareholders: [{ corporationId: targetId, shares: 6_000_000 }],
    } as any as Corporation;
    db.collection("corporations").find = vi.fn().mockReturnValue({
      toArray: async () => [parentControlledByTarget, targetCorp(60)],
    });
    const result = await formalizeSubsidiary(db as unknown as Db, {
      parent: parentCorp(),
      target: targetCorp(60),
      ...base,
    });
    expect(result.ok).toBe(false);
  });

  it("rejects when the caller is not the parent CEO", async () => {
    const result = await formalizeSubsidiary(db as unknown as Db, {
      parent: parentCorp({ userId: otherUserId }),
      target: targetCorp(60),
      ...base,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(403);
  });
});
