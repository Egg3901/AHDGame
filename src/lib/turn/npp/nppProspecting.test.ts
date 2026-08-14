import { describe, it, expect } from "vitest";
import { pickNppProspect, NPP_PROSPECT_SHORTAGE_RATIO } from "./nppProspecting";

describe("pickNppProspect", () => {
  it("picks the shortest resource the miner actually produces", () => {
    const pick = pickNppProspect({
      corpId: "c1",
      cashLocal: 10_000_000,
      fxRate: 1,
      currencyCode: "USD",
      sectors: [{ sectorType: "extraction", stateId: "TX", strategyId: "iron_mining" }],
      priceRatioOf: (r) => (r === "iron" ? 1.5 : 1),
      priorSuccessCountOf: () => 0,
      hasDeposit: () => true,
    });
    expect(pick).toEqual({ corpId: "c1", stateId: "TX", resource: "iron" });
  });

  it("skips when no extractable is in shortage", () => {
    const pick = pickNppProspect({
      corpId: "c1",
      cashLocal: 10_000_000,
      fxRate: 1,
      currencyCode: "USD",
      sectors: [{ sectorType: "extraction", stateId: "TX", strategyId: "iron_mining" }],
      priceRatioOf: () => NPP_PROSPECT_SHORTAGE_RATIO - 0.01,
      priorSuccessCountOf: () => 0,
      hasDeposit: () => true,
    });
    expect(pick).toBeNull();
  });

  it("skips a mothballed pit", () => {
    const pick = pickNppProspect({
      corpId: "c1",
      cashLocal: 10_000_000,
      fxRate: 1,
      currencyCode: "USD",
      sectors: [
        { sectorType: "extraction", stateId: "TX", strategyId: "iron_mining", mothballed: true },
      ],
      priceRatioOf: () => 2,
      priorSuccessCountOf: () => 0,
      hasDeposit: () => true,
    });
    expect(pick).toBeNull();
  });

  it("skips a resource the state does not actually hold", () => {
    const pick = pickNppProspect({
      corpId: "c1",
      cashLocal: 10_000_000,
      fxRate: 1,
      currencyCode: "USD",
      sectors: [{ sectorType: "extraction", stateId: "TX", strategyId: "iron_mining" }],
      priceRatioOf: () => 2,
      priorSuccessCountOf: () => 0,
      hasDeposit: () => false,
    });
    expect(pick).toBeNull();
  });

  it("skips when the survey would consume more than a quarter of cash", () => {
    const pick = pickNppProspect({
      corpId: "c1",
      cashLocal: 100_000,
      fxRate: 1,
      currencyCode: "USD",
      sectors: [{ sectorType: "extraction", stateId: "TX", strategyId: "iron_mining" }],
      priceRatioOf: () => 2,
      priorSuccessCountOf: () => 0,
      hasDeposit: () => true,
    });
    expect(pick).toBeNull();
  });
});
