import { describe, expect, it } from "vitest";
import { addSettledPoliticalAttention } from "./reach";

const commercialOutletsByState = new Map([
  [
    "S1",
    [
      {
        corporationId: "commercial",
        stance: { economic: -2, social: 1 },
        audienceShare: 1,
        attentionUnits: 100,
      },
    ],
  ],
]);

describe("funded media model reach", () => {
  it("counts exact paid allocations and excludes open settlement plans", () => {
    const outlets = addSettledPoliticalAttention({
      commercialOutletsByState,
      settledOrders: [
        {
          orderId: "open-order",
          status: "settling",
          identity: { targetStateId: "S1" },
          settlementPlan: {
            sellers: [{ allocationId: "unpaid", corporationId: "political-only", units: 60 }],
          },
        },
        {
          orderId: "paid-order",
          status: "settled",
          identity: { targetStateId: "S1" },
          settlementPlan: {
            sellers: [{ allocationId: "allocation-1", corporationId: "political-only", units: 40 }],
          },
        },
      ],
      stanceByCorporationId: new Map([["political-only", { economic: 5, social: -3 }]]),
    });

    expect(outlets.get("S1")).toEqual([
      {
        corporationId: "commercial",
        stance: { economic: -2, social: 1 },
        audienceShare: 100 / 140,
        attentionUnits: 100,
      },
      {
        corporationId: "political-only",
        stance: { economic: 5, social: -3 },
        audienceShare: 40 / 140,
        attentionUnits: 40,
      },
    ]);
  });

  it("leaves commercial reach unchanged when no political allocations settled", () => {
    const result = addSettledPoliticalAttention({
      commercialOutletsByState,
      settledOrders: [
        {
          orderId: "planned",
          status: "open",
          identity: { targetStateId: "S1" },
          settlementPlan: {
            sellers: [{ allocationId: "allocation", corporationId: "another", units: 20 }],
          },
        },
      ],
      stanceByCorporationId: new Map(),
    });
    expect(result.get("S1")).toEqual(commercialOutletsByState.get("S1"));
  });

  it("deduplicates allocation witnesses and supports political-only outlets", () => {
    const order = {
      orderId: "paid-order",
      status: "settled" as const,
      identity: { targetStateId: "S2" },
      settlementPlan: {
        sellers: [{ allocationId: "same", corporationId: "only", units: 25 }],
      },
    };
    const result = addSettledPoliticalAttention({
      commercialOutletsByState: new Map(),
      settledOrders: [order, order],
      stanceByCorporationId: new Map(),
    });
    expect(result.get("S2")).toEqual([
      {
        corporationId: "only",
        stance: { economic: 0, social: 0 },
        audienceShare: 1,
        attentionUnits: 25,
      },
    ]);
  });
});
