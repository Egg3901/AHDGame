import { describe, expect, it } from "vitest";
import { marketTelemetry } from "./sectorTelemetry";

describe("market telemetry turn identity", () => {
  it("stamps the turn of the persisted sold fractions", () => {
    const telemetry = marketTelemetry({
      clearingEnabled: true,
      clearing: {
        factor: 0.75,
        soldFraction: 0.75,
        soldByCommodity: { advertising: 0.5 },
        effectivePosture: 0,
      },
      clearingFactor: 0.75,
      currentTurn: 24,
      mothballed: false,
      sector: { lowFillTurns: 0 },
    });

    expect(telemetry).toMatchObject({
      soldByCommodity: { advertising: 0.5 },
      soldByCommodityTurn: 24,
    });
  });
});
