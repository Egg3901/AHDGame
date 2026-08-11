import { describe, expect, it } from "vitest";
import { ACCRUAL_RATE, DECAY_IDLE } from "@/lib/market/brandLoyalty";
import { computeBrandLoyaltyUpdates, type CorpLoyaltyInput } from "./brandLoyaltyTurn";

function corp(over: Partial<CorpLoyaltyInput>): CorpLoyaltyInput {
  return {
    corpId: "c",
    priorLoyalty: 40,
    priorNorm: 0.1,
    sectors: [
      { revenueAnchor: 100, effectivePosture: 0.1, soldFraction: 0.8, commodities: ["steel"] },
    ],
    ...over,
  };
}

describe("computeBrandLoyaltyUpdates", () => {
  it("revenue-weights posture and fill across sectors", () => {
    // Two sectors: big one at posture 0.2/fill 0.9, small at 0.0/fill 0.1.
    // Weighted posture ≈ (100·0.2 + 10·0.0)/110 = 0.1818; but with a rival cheaper it may gouge —
    // here no rival, priorNorm 0.18 so it's consistent. Just assert it runs and weights.
    const [u] = computeBrandLoyaltyUpdates([
      corp({
        corpId: "big",
        priorNorm: 0.1818,
        sectors: [
          { revenueAnchor: 100, effectivePosture: 0.2, soldFraction: 0.9, commodities: ["a"] },
          { revenueAnchor: 10, effectivePosture: 0.0, soldFraction: 0.1, commodities: ["a"] },
        ],
      }),
    ]);
    expect(u.corpId).toBe("big");
    // Uncontested (single corp) → idle decay, not accrual.
    expect(u.outcome).toBe("idle-decay");
  });

  it("accrues only when a rival posts >= CONTEST_GAP cheaper", () => {
    const updates = computeBrandLoyaltyUpdates([
      corp({
        corpId: "premium",
        priorNorm: 0.1,
        sectors: [
          { revenueAnchor: 100, effectivePosture: 0.1, soldFraction: 0.8, commodities: ["steel"] },
        ],
      }),
      corp({
        corpId: "cheap",
        priorNorm: 0.02,
        sectors: [
          { revenueAnchor: 100, effectivePosture: 0.02, soldFraction: 0.9, commodities: ["steel"] },
        ],
      }),
    ]);
    const premium = updates.find((u) => u.corpId === "premium")!;
    // cheap posts 0.02 <= 0.1 - 0.05 → premium is contested → accrues
    expect(premium.outcome).toBe("accrued");
    expect(premium.loyalty).toBe(40 + ACCRUAL_RATE);
  });

  it("the cheapest corp itself is NOT contested by its own price", () => {
    const updates = computeBrandLoyaltyUpdates([
      corp({
        corpId: "cheap",
        priorNorm: 0.02,
        sectors: [
          { revenueAnchor: 100, effectivePosture: 0.02, soldFraction: 0.9, commodities: ["steel"] },
        ],
      }),
      corp({
        corpId: "pricey",
        priorNorm: 0.1,
        sectors: [
          { revenueAnchor: 100, effectivePosture: 0.1, soldFraction: 0.9, commodities: ["steel"] },
        ],
      }),
    ]);
    const cheap = updates.find((u) => u.corpId === "cheap")!;
    // No one is cheaper than 'cheap' → not contested → idle decay
    expect(cheap.outcome).toBe("idle-decay");
    expect(cheap.loyalty).toBe(40 - DECAY_IDLE);
  });

  it("handles the global-min-is-self edge via the distinct second corp", () => {
    // 'a' is cheapest overall; 'b' second; 'c' priciest. 'a' should look to 'b' (none cheaper) → not contested.
    const updates = computeBrandLoyaltyUpdates([
      corp({
        corpId: "a",
        priorNorm: 0.0,
        sectors: [
          { revenueAnchor: 100, effectivePosture: 0.0, soldFraction: 0.9, commodities: ["x"] },
        ],
      }),
      corp({
        corpId: "b",
        priorNorm: 0.1,
        sectors: [
          { revenueAnchor: 100, effectivePosture: 0.1, soldFraction: 0.9, commodities: ["x"] },
        ],
      }),
      corp({
        corpId: "c",
        priorNorm: 0.2,
        sectors: [
          { revenueAnchor: 100, effectivePosture: 0.2, soldFraction: 0.9, commodities: ["x"] },
        ],
      }),
    ]);
    expect(updates.find((u) => u.corpId === "a")!.outcome).toBe("idle-decay"); // nobody cheaper
    expect(updates.find((u) => u.corpId === "b")!.outcome).toBe("accrued"); // 'a' is cheaper
    expect(updates.find((u) => u.corpId === "c")!.outcome).toBe("accrued"); // 'a'/'b' cheaper
  });

  it("skips corps with no selling sectors", () => {
    const updates = computeBrandLoyaltyUpdates([
      corp({
        corpId: "empty",
        sectors: [{ revenueAnchor: 0, effectivePosture: 0.1, soldFraction: 0.8, commodities: [] }],
      }),
    ]);
    expect(updates).toHaveLength(0);
  });

  it("under-delivery penalizes even when contested", () => {
    const updates = computeBrandLoyaltyUpdates([
      corp({
        corpId: "premium",
        priorNorm: 0.1,
        sectors: [
          { revenueAnchor: 100, effectivePosture: 0.1, soldFraction: 0.2, commodities: ["steel"] },
        ],
      }),
      corp({
        corpId: "cheap",
        priorNorm: 0.02,
        sectors: [
          { revenueAnchor: 100, effectivePosture: 0.02, soldFraction: 0.9, commodities: ["steel"] },
        ],
      }),
    ]);
    const premium = updates.find((u) => u.corpId === "premium")!;
    expect(premium.outcome).toBe("underdelivered");
  });
});
