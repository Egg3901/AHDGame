import { describe, expect, it } from "vitest";
import { ObjectId } from "mongodb";
import { planProportionalHoldingsSale } from "./fundRedemptionLiquidity";

describe("planProportionalHoldingsSale", () => {
  const corpA = new ObjectId();
  const corpB = new ObjectId();

  it("returns empty when no cash is needed", () => {
    expect(
      planProportionalHoldingsSale(
        [{ corporationId: corpA, shares: 100, pricePerShareAnchor: 10 }],
        0
      )
    ).toEqual([]);
  });

  it("sells all holdings when cash need exceeds portfolio value", () => {
    expect(
      planProportionalHoldingsSale(
        [
          { corporationId: corpA, shares: 10, pricePerShareAnchor: 100 },
          { corporationId: corpB, shares: 5, pricePerShareAnchor: 20 },
        ],
        2000
      )
    ).toEqual([
      {
        corporationId: corpA,
        shares: 10,
        pricePerShareAnchor: 100,
        sharesToSell: 10,
        proceedsAnchor: 1000,
      },
      {
        corporationId: corpB,
        shares: 5,
        pricePerShareAnchor: 20,
        sharesToSell: 5,
        proceedsAnchor: 100,
      },
    ]);
  });

  it("allocates sales proportionally by holding value", () => {
    const plan = planProportionalHoldingsSale(
      [
        { corporationId: corpA, shares: 100, pricePerShareAnchor: 10 },
        { corporationId: corpB, shares: 50, pricePerShareAnchor: 10 },
      ],
      750
    );

    const totalProceeds = plan.reduce((sum, row) => sum + row.proceedsAnchor, 0);
    expect(totalProceeds).toBeGreaterThanOrEqual(500);
    expect(totalProceeds).toBeLessThanOrEqual(750);
    expect(plan.find((p) => p.corporationId.equals(corpA))?.sharesToSell).toBeGreaterThan(
      plan.find((p) => p.corporationId.equals(corpB))?.sharesToSell ?? 0
    );
  });
});
