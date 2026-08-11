import { describe, it, expect } from "vitest";
import { computeMarketDemand } from "../marketDemand";
import type { SovereignDemandSnapshot } from "../types";

function baseline(): SovereignDemandSnapshot {
  return {
    countryCode: "US",
    currentTurn: 1000,
    debtToGdp: 0.6, // exactly at floor — no penalty
    inflationRate: 0.05, // exactly at floor — no penalty
    trust: 0.5, // neutral
    sovereignCouponRate: 4.0, // matches benchmark — no premium
    fxDepreciationRate10t: 0,
    turnsSinceLastDefault: null,
    entityHoldings: 0,
    requiredIssuance: 0,
  };
}

describe("computeMarketDemand — baseline scenarios", () => {
  it("at perfect baseline produces demand equal to BASE_DEMAND (1.2)", () => {
    const result = computeMarketDemand(baseline());
    expect(result.demandRatio).toBeCloseTo(1.2);
  });

  it("returns components in stable order", () => {
    const result = computeMarketDemand(baseline());
    const ids = result.components.map((c) => c.id);
    expect(ids).toEqual([
      "base",
      "debtToGdp",
      "debtToGdpCliff",
      "inflation",
      "fxDepreciation",
      "defaultScar",
      "trust",
      "couponPremium",
      "entityHoldings",
    ]);
  });

  it("never returns negative demand (clamped to zero)", () => {
    const catastrophic: SovereignDemandSnapshot = {
      ...baseline(),
      debtToGdp: 5.0, // 500% D/GDP
      inflationRate: 0.5, // 50% inflation
      fxDepreciationRate10t: 0.8, // 80% currency collapse
      trust: 0,
      sovereignCouponRate: 0, // can't even offer premium
    };
    const result = computeMarketDemand(catastrophic);
    expect(result.demandRatio).toBeGreaterThanOrEqual(0);
  });
});

describe("computeMarketDemand — debt-to-GDP penalty", () => {
  it("applies graduated penalty above 60% D/GDP (0.30 per unit)", () => {
    const snap: SovereignDemandSnapshot = { ...baseline(), debtToGdp: 1.0 };
    const result = computeMarketDemand(snap);
    const dgdpComponent = result.components.find((c) => c.id === "debtToGdp");
    expect(dgdpComponent?.contribution).toBeCloseTo(-0.4 * 0.3); // (1.0 - 0.6) * 0.3
  });

  it("applies cliff penalty above 200% D/GDP (additive 0.40 per unit)", () => {
    const snap: SovereignDemandSnapshot = { ...baseline(), debtToGdp: 2.5 };
    const result = computeMarketDemand(snap);
    const cliffComponent = result.components.find((c) => c.id === "debtToGdpCliff");
    expect(cliffComponent?.contribution).toBeCloseTo(-0.5 * 0.4); // (2.5 - 2.0) * 0.4
  });

  it("at 60% D/GDP exactly, contributes zero", () => {
    const snap: SovereignDemandSnapshot = { ...baseline(), debtToGdp: 0.6 };
    const result = computeMarketDemand(snap);
    expect(result.components.find((c) => c.id === "debtToGdp")?.contribution).toBe(0);
    expect(result.components.find((c) => c.id === "debtToGdpCliff")?.contribution).toBe(0);
  });
});

describe("computeMarketDemand — inflation penalty", () => {
  it("at 5% inflation exactly, contributes zero", () => {
    const snap: SovereignDemandSnapshot = { ...baseline(), inflationRate: 0.05 };
    const result = computeMarketDemand(snap);
    expect(result.components.find((c) => c.id === "inflation")?.contribution).toBe(0);
  });

  it("applies penalty above 5% inflation (rate 2.0)", () => {
    const snap: SovereignDemandSnapshot = { ...baseline(), inflationRate: 0.1 };
    const result = computeMarketDemand(snap);
    expect(result.components.find((c) => c.id === "inflation")?.contribution).toBeCloseTo(
      -0.05 * 2.0
    );
  });
});

describe("computeMarketDemand — FX depreciation penalty", () => {
  it("zero depreciation contributes zero", () => {
    const result = computeMarketDemand({ ...baseline(), fxDepreciationRate10t: 0 });
    expect(result.components.find((c) => c.id === "fxDepreciation")?.contribution).toBe(0);
  });

  it("20% depreciation contributes -0.30 (rate 1.5)", () => {
    const result = computeMarketDemand({ ...baseline(), fxDepreciationRate10t: 0.2 });
    expect(result.components.find((c) => c.id === "fxDepreciation")?.contribution).toBeCloseTo(
      -0.3
    );
  });

  it("appreciation (negative deprec) is treated as zero — only penalize, never reward", () => {
    const result = computeMarketDemand({ ...baseline(), fxDepreciationRate10t: -0.2 });
    expect(result.components.find((c) => c.id === "fxDepreciation")?.contribution).toBe(0);
  });
});

describe("computeMarketDemand — default scar", () => {
  it("never-defaulted country contributes zero", () => {
    const result = computeMarketDemand({ ...baseline(), turnsSinceLastDefault: null });
    expect(result.components.find((c) => c.id === "defaultScar")?.contribution).toBe(0);
  });

  it("100+ turns since default contributes zero (fully faded)", () => {
    const result = computeMarketDemand({ ...baseline(), turnsSinceLastDefault: 100 });
    expect(result.components.find((c) => c.id === "defaultScar")?.contribution).toBe(0);
  });

  it("just-defaulted country contributes -1.0 (max scar)", () => {
    const result = computeMarketDemand({ ...baseline(), turnsSinceLastDefault: 0 });
    expect(result.components.find((c) => c.id === "defaultScar")?.contribution).toBeCloseTo(-1.0);
  });

  it("50 turns since default contributes -0.5 (linear decay)", () => {
    const result = computeMarketDemand({ ...baseline(), turnsSinceLastDefault: 50 });
    expect(result.components.find((c) => c.id === "defaultScar")?.contribution).toBeCloseTo(-0.5);
  });
});

describe("computeMarketDemand — trust modifier", () => {
  it("trust 0.5 (neutral) contributes zero", () => {
    const result = computeMarketDemand({ ...baseline(), trust: 0.5 });
    expect(result.components.find((c) => c.id === "trust")?.contribution).toBe(0);
  });

  it("max trust (1.0) contributes +0.20 (rate 0.40)", () => {
    const result = computeMarketDemand({ ...baseline(), trust: 1.0 });
    expect(result.components.find((c) => c.id === "trust")?.contribution).toBeCloseTo(0.2);
  });

  it("zero trust contributes -0.20", () => {
    const result = computeMarketDemand({ ...baseline(), trust: 0.0 });
    expect(result.components.find((c) => c.id === "trust")?.contribution).toBeCloseTo(-0.2);
  });
});

describe("computeMarketDemand — coupon premium", () => {
  it("coupon at benchmark (4%) contributes zero", () => {
    const result = computeMarketDemand({ ...baseline(), sovereignCouponRate: 4.0 });
    expect(result.components.find((c) => c.id === "couponPremium")?.contribution).toBe(0);
  });

  it("2pp premium above benchmark contributes +0.10 (rate 5.0)", () => {
    const result = computeMarketDemand({ ...baseline(), sovereignCouponRate: 6.0 });
    expect(result.components.find((c) => c.id === "couponPremium")?.contribution).toBeCloseTo(0.1);
  });

  it("coupon below benchmark produces negative premium (yield pinching)", () => {
    const result = computeMarketDemand({ ...baseline(), sovereignCouponRate: 2.0 });
    expect(result.components.find((c) => c.id === "couponPremium")?.contribution).toBeCloseTo(-0.1);
  });
});

describe("computeMarketDemand — entity holdings contribution (Model B)", () => {
  it("zero entity holdings contribute zero", () => {
    const result = computeMarketDemand({
      ...baseline(),
      entityHoldings: 0,
      requiredIssuance: 1_000_000_000,
    });
    expect(result.components.find((c) => c.id === "entityHoldings")?.contribution).toBe(0);
  });

  it("zero requiredIssuance contributes zero (avoid divide-by-zero)", () => {
    const result = computeMarketDemand({
      ...baseline(),
      entityHoldings: 5_000_000_000,
      requiredIssuance: 0,
    });
    expect(result.components.find((c) => c.id === "entityHoldings")?.contribution).toBe(0);
  });

  it("contribution scales linearly below the cap: holdings = 0.5x issuance contributes 0.25", () => {
    // ratio 0.5 → contribution = 0.5 * ENTITY_DEMAND_WEIGHT (0.5) = 0.25 (below 0.4 cap)
    const result = computeMarketDemand({
      ...baseline(),
      entityHoldings: 500_000_000,
      requiredIssuance: 1_000_000_000,
    });
    expect(result.components.find((c) => c.id === "entityHoldings")?.contribution).toBeCloseTo(
      0.25
    );
  });

  it("contribution at exactly cap-boundary ratio (0.8x issuance) = 0.4 cap exactly", () => {
    const result = computeMarketDemand({
      ...baseline(),
      entityHoldings: 800_000_000,
      requiredIssuance: 1_000_000_000,
    });
    expect(result.components.find((c) => c.id === "entityHoldings")?.contribution).toBeCloseTo(0.4);
  });

  it("contribution caps at ENTITY_DEMAND_CAP (0.4) regardless of how much is held", () => {
    const result = computeMarketDemand({
      ...baseline(),
      entityHoldings: 100_000_000_000, // 100x oversubscribed
      requiredIssuance: 1_000_000_000,
    });
    // Uncapped would be 100 * 0.5 = 50; cap is 0.4
    expect(result.components.find((c) => c.id === "entityHoldings")?.contribution).toBeCloseTo(0.4);
  });

  it("contribution is positive (entity holdings boost demand)", () => {
    const result = computeMarketDemand({
      ...baseline(),
      entityHoldings: 500_000_000,
      requiredIssuance: 1_000_000_000,
    });
    expect(result.components.find((c) => c.id === "entityHoldings")?.contribution).toBeGreaterThan(
      0
    );
  });
});
