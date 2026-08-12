import { describe, it, expect, vi, beforeEach } from "vitest";
import { ObjectId } from "mongodb";
import type { Db } from "mongodb";
import { corpPurchaseWouldCycle, OWNERSHIP_CYCLE_ERROR } from "./cycleGuard";

const A = new ObjectId();
const B = new ObjectId();
const C = new ObjectId();

/** B is controlled by A: A holds 60% of B's votes. */
function corpsWhereAControlsB() {
  return [
    { _id: A, totalShares: 100, shareholders: [{ characterId: new ObjectId(), shares: 100 }] },
    { _id: B, totalShares: 100, shareholders: [{ corporationId: A, shares: 60 }] },
    { _id: C, totalShares: 100, shareholders: [{ characterId: new ObjectId(), shares: 100 }] },
  ];
}

function makeDb(corps: unknown[]) {
  return {
    collection: vi.fn(() => ({
      find: vi.fn(() => ({ toArray: async () => corps })),
    })),
  } as unknown as Db;
}

describe("corpPurchaseWouldCycle", () => {
  beforeEach(() => vi.clearAllMocks());

  it("blocks a subsidiary buying into the parent that controls it", async () => {
    // A controls B. B buying A would close the loop.
    expect(await corpPurchaseWouldCycle(makeDb(corpsWhereAControlsB()), B, A)).toBe(true);
  });

  it("blocks a corporation buying its own shares", async () => {
    expect(await corpPurchaseWouldCycle(makeDb(corpsWhereAControlsB()), A, A)).toBe(true);
  });

  it("allows a parent buying more of its own subsidiary", async () => {
    expect(await corpPurchaseWouldCycle(makeDb(corpsWhereAControlsB()), A, B)).toBe(false);
  });

  it("allows an unrelated purchase", async () => {
    expect(await corpPurchaseWouldCycle(makeDb(corpsWhereAControlsB()), C, B)).toBe(false);
  });

  it("blocks across a chain: A controls B controls C, C cannot buy A", async () => {
    const corps = [
      { _id: A, totalShares: 100, shareholders: [{ characterId: new ObjectId(), shares: 100 }] },
      { _id: B, totalShares: 100, shareholders: [{ corporationId: A, shares: 60 }] },
      { _id: C, totalShares: 100, shareholders: [{ corporationId: B, shares: 80 }] },
    ];
    expect(await corpPurchaseWouldCycle(makeDb(corps), C, A)).toBe(true);
  });

  it("has a message that names the loop rather than a generic refusal", () => {
    expect(OWNERSHIP_CYCLE_ERROR).toMatch(/circular ownership/i);
  });
});
