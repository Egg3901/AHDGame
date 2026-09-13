import { describe, expect, it } from "vitest";
import { COMMODITY_BASE_PRICES } from "@/lib/constants/commodities";
import { computeContractProductionTargets } from "./contractProductionDemand";

describe("computeContractProductionTargets", () => {
  it("allocates a corporation-wide reservation by sector capacity", () => {
    const targets = computeContractProductionTargets({
      reservations: new Map([["corp", new Map([["energy", 200]])]]),
      sectors: [
        {
          sectorId: "small",
          corporationId: "corp",
          capacityUnits: 100,
          supplyRates: { energy: 1 },
        },
        {
          sectorId: "large",
          corporationId: "corp",
          capacityUnits: 300,
          supplyRates: { energy: 1 },
        },
      ],
      basePrices: COMMODITY_BASE_PRICES,
    });

    expect(targets.get("small")).toBeCloseTo(50, 8);
    expect(targets.get("large")).toBeCloseTo(150, 8);
  });

  it("keeps a state-scoped reservation on that state's sectors", () => {
    const targets = computeContractProductionTargets({
      reservations: new Map([["corp", new Map([["freight@S1", 80]])]]),
      sectors: [
        {
          sectorId: "s1",
          corporationId: "corp",
          stateId: "S1",
          capacityUnits: 100,
          supplyRates: { freight: 1 },
        },
        {
          sectorId: "s2",
          corporationId: "corp",
          stateId: "S2",
          capacityUnits: 1000,
          supplyRates: { freight: 1 },
        },
      ],
      basePrices: COMMODITY_BASE_PRICES,
    });

    expect(targets.get("s1")).toBeCloseTo(80, 8);
    expect(targets.has("s2")).toBe(false);
  });
});
