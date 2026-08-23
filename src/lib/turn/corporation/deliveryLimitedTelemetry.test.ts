import { describe, expect, it } from "vitest";
import {
  deliveryLimitedTelemetry,
  resolveDeliveryLimitedTelemetry,
} from "./deliveryLimitedTelemetry";

describe("resolveDeliveryLimitedTelemetry (ticket #1169)", () => {
  it("drops the flag entirely when the sector sold everything it made", () => {
    // The live shape behind the ticket: Napoleon Hill's 18 US energy sectors all
    // sat at soldFraction 1.0 with a state seam ratio of 0.82-0.99, so the row
    // showed "Fill 100%" next to "Delivery limited 96%".
    const result = resolveDeliveryLimitedTelemetry({
      stateRatio: 0.96,
      soldFraction: 1,
      freightClass: "grid",
    });

    expect(result.fraction).toBe(0);
    expect(result.freightClass).toBeNull();
  });

  it("caps the share at the fill shortfall the row actually shows", () => {
    const result = resolveDeliveryLimitedTelemetry({
      stateRatio: 0.9,
      soldFraction: 0.6,
      freightClass: "bulk",
    });

    // 60% sold leaves 40% unsold, so at most 40% of output can be undelivered.
    expect(result.fraction).toBeCloseTo(0.4, 5);
    expect(result.freightClass).toBe("bulk");
  });

  it("leaves a genuine glut split alone", () => {
    const result = resolveDeliveryLimitedTelemetry({
      stateRatio: 0.1,
      soldFraction: 0.6,
      freightClass: "special",
    });

    // 40% shortfall, a tenth of output undelivered: the rest is demand.
    expect(result.fraction).toBeCloseTo(0.1, 5);
    expect(result.freightClass).toBe("special");
  });

  it("passes the raw state ratio through on ledger worlds, where no fill exists", () => {
    // marketSystemMode "ledger" runs freight settlement with clearing OFF. That
    // tier is observability only and has no fill number to contradict.
    const result = resolveDeliveryLimitedTelemetry({
      stateRatio: 0.96,
      soldFraction: null,
      freightClass: "bulk",
    });

    expect(result.fraction).toBeCloseTo(0.96, 5);
    expect(result.freightClass).toBe("bulk");
  });

  it("treats an unmeasured state as no evidence of a limit", () => {
    expect(
      resolveDeliveryLimitedTelemetry({
        stateRatio: null,
        soldFraction: 0.4,
        freightClass: "bulk",
      })
    ).toEqual({ fraction: 0, freightClass: null });
  });

  it("clamps out-of-range inputs instead of trusting them", () => {
    expect(
      resolveDeliveryLimitedTelemetry({
        stateRatio: 1.4,
        soldFraction: -0.2,
        freightClass: "bulk",
      }).fraction
    ).toBe(1);

    expect(
      resolveDeliveryLimitedTelemetry({
        stateRatio: Number.NaN,
        soldFraction: 0.5,
        freightClass: "bulk",
      }).fraction
    ).toBe(0);

    // soldFraction can come back above 1 when the clearing factor overshoots;
    // that is still a fully sold sector, not a negative shortfall.
    expect(
      resolveDeliveryLimitedTelemetry({
        stateRatio: 0.9,
        soldFraction: 1.3,
        freightClass: "grid",
      }).fraction
    ).toBe(0);
  });

  it("rounds to the same three places the sector document stores", () => {
    const result = resolveDeliveryLimitedTelemetry({
      stateRatio: 0.123456,
      soldFraction: 0.5,
      freightClass: "bulk",
    });

    expect(result.fraction).toBe(0.123);
  });
});

describe("deliveryLimitedTelemetry update fragment", () => {
  const sector = (deliveryLimitedFraction?: number) =>
    ({ deliveryLimitedFraction }) as Parameters<typeof deliveryLimitedTelemetry>[0]["sector"];

  it("writes nothing on a world with freight settlement off", () => {
    expect(
      deliveryLimitedTelemetry({
        sector: sector(),
        stateRatio: undefined,
        soldFraction: 0.5,
        freightClass: null,
      })
    ).toEqual({});
  });

  it("still clears a value a settlement world left behind", () => {
    expect(
      deliveryLimitedTelemetry({
        sector: sector(0.82),
        stateRatio: undefined,
        soldFraction: 0.5,
        freightClass: null,
      })
    ).toEqual({ deliveryLimitedFraction: 0, deliveryLimitedFreightClass: null });
  });

  it("persists the reconciled pair when the seam measured a limit", () => {
    expect(
      deliveryLimitedTelemetry({
        sector: sector(),
        stateRatio: 0.9,
        soldFraction: 0.6,
        freightClass: "bulk",
      })
    ).toEqual({ deliveryLimitedFraction: 0.4, deliveryLimitedFreightClass: "bulk" });
  });

  it("clears the class along with the share on a fully sold sector", () => {
    expect(
      deliveryLimitedTelemetry({
        sector: sector(0.96),
        stateRatio: 0.96,
        soldFraction: 1,
        freightClass: "grid",
      })
    ).toEqual({ deliveryLimitedFraction: 0, deliveryLimitedFreightClass: null });
  });
});
