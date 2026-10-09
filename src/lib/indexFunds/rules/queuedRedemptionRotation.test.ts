import { describe, expect, it } from "vitest";
import { orderQueuedRedemptionFunds, queuedRedemptionClaimShare } from "./queuedRedemptionRotation";

/** Funds that get a claim in one pass: one each at the front of the rotation. */
function servedThisTurn(ids: string[], budget: number, turn: number): string[] {
  const order = orderQueuedRedemptionFunds(ids, budget, turn);
  const served: string[] = [];
  let left = budget;
  order.forEach((id, i) => {
    const share = queuedRedemptionClaimShare(left, order.length - i);
    if (share > 0) served.push(id);
    left -= share;
  });
  return served;
}

describe("queued redemption fund rotation", () => {
  it("serves every one of 300 funds within ceil(300 / 250) turns at 250 claims", () => {
    const ids = Array.from({ length: 300 }, (_, i) => `f${String(i).padStart(3, "0")}`);
    for (const start of [0, 1, 7, 1_000_003]) {
      const seen = new Set<string>();
      for (let t = start; t < start + 2; t++) {
        const served = servedThisTurn(ids, 250, t);
        expect(served).toHaveLength(250);
        served.forEach((id) => seen.add(id));
      }
      expect(seen.size).toBe(300);
    }
  });

  it("is a stable-id permutation independent of input order", () => {
    const ids = ["c", "a", "b", "a"];
    expect(orderQueuedRedemptionFunds(ids, 1, 0)).toEqual(["a", "b", "c"]);
    expect(orderQueuedRedemptionFunds([...ids].reverse(), 1, 1)).toEqual(["b", "c", "a"]);
    expect(orderQueuedRedemptionFunds([], 250, 9)).toEqual([]);
  });

  it("splits the budget evenly and never hands out claims it does not have", () => {
    expect(queuedRedemptionClaimShare(250, 61)).toBe(5);
    expect(queuedRedemptionClaimShare(3, 5)).toBe(1);
    expect(queuedRedemptionClaimShare(0, 5)).toBe(0);
  });
});
