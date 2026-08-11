import { describe, it, expect } from "vitest";
import { computeMarketDemand } from "../marketDemand";
import type { SovereignDemandSnapshot } from "../types";

/**
 * Archetype profiles based on real-world sovereign-debt dynamics.
 * Tests that formula calibration produces sensible outputs across the spectrum.
 *
 * These are not exact reproductions of any specific country state — they're
 * stylized profiles to verify the formula directionally.
 */
describe("computeMarketDemand — country archetype integration", () => {
  it("Japan-like profile: synthetic-only formula UNDER-models high-D/GDP-low-yield case (Phase 3 entity contribution will offset)", () => {
    const japan: SovereignDemandSnapshot = {
      countryCode: "JP",
      currentTurn: 1000,
      debtToGdp: 2.6,
      inflationRate: 0.01,
      trust: 0.7,
      sovereignCouponRate: 1.5, // famously low yield
      fxDepreciationRate10t: 0,
      turnsSinceLastDefault: null,
      entityHoldings: 0,
      requiredIssuance: 0,
    };
    const result = computeMarketDemand(japan);
    // High D/GDP penalty is severe; offsets (low inflation, stable FX, high trust)
    // are partial. Phase 2 alone WILL show Japan in failed-auction territory.
    // This is intentional — Phase 3 layers entity participation (captive
    // domestic demand) which is precisely what makes real Japan survivable
    // at 260% D/GDP. Don't gold-plate Phase 2's calibration to fix Japan.
    expect(result.demandRatio).toBeGreaterThanOrEqual(0);
    expect(Number.isFinite(result.demandRatio)).toBe(true);
    expect(result.demandRatio).toBeLessThan(2.0);
  });

  it("Argentina-like profile (high D/GDP, runaway inflation, currency collapse, low trust) lands well below 0.7", () => {
    const argentina: SovereignDemandSnapshot = {
      countryCode: "AR",
      currentTurn: 1000,
      debtToGdp: 1.0,
      inflationRate: 0.5, // 50% — runaway
      trust: 0.25,
      sovereignCouponRate: 8.0, // even with premium
      fxDepreciationRate10t: 0.3, // 30% currency drop
      turnsSinceLastDefault: 30, // recent default scar
      entityHoldings: 0,
      requiredIssuance: 0,
    };
    const result = computeMarketDemand(argentina);
    expect(result.demandRatio).toBeLessThan(0.7); // failed-auction territory
  });

  it("US-like profile (moderate D/GDP, low inflation, mid trust, stable FX) lands above 0.7 but below full", () => {
    const us: SovereignDemandSnapshot = {
      countryCode: "US",
      currentTurn: 1000,
      debtToGdp: 1.2,
      inflationRate: 0.025,
      trust: 0.55,
      sovereignCouponRate: 4.5, // matches roughly the benchmark
      fxDepreciationRate10t: 0,
      turnsSinceLastDefault: null,
      entityHoldings: 0,
      requiredIssuance: 0,
    };
    const result = computeMarketDemand(us);
    expect(result.demandRatio).toBeGreaterThanOrEqual(0.7); // not failed
    expect(result.demandRatio).toBeLessThanOrEqual(1.5);
  });

  it("Pristine profile (low D/GDP, no inflation, perfect trust) lands at full demand or above", () => {
    const pristine: SovereignDemandSnapshot = {
      countryCode: "XX",
      currentTurn: 1000,
      debtToGdp: 0.3,
      inflationRate: 0.02,
      trust: 1.0,
      sovereignCouponRate: 4.0,
      fxDepreciationRate10t: 0,
      turnsSinceLastDefault: null,
      entityHoldings: 0,
      requiredIssuance: 0,
    };
    const result = computeMarketDemand(pristine);
    expect(result.demandRatio).toBeGreaterThanOrEqual(1.0);
  });

  it("Catastrophic profile (every signal at worst) lands at zero, not negative", () => {
    const catastrophic: SovereignDemandSnapshot = {
      countryCode: "XX",
      currentTurn: 1000,
      debtToGdp: 5.0,
      inflationRate: 1.0,
      trust: 0.0,
      sovereignCouponRate: 0,
      fxDepreciationRate10t: 1.0,
      turnsSinceLastDefault: 0,
      entityHoldings: 0,
      requiredIssuance: 0,
    };
    const result = computeMarketDemand(catastrophic);
    expect(result.demandRatio).toBe(0);
  });

  it("recent-default scar fades to zero by turn 100", () => {
    const recovered: SovereignDemandSnapshot = {
      countryCode: "XX",
      currentTurn: 1000,
      debtToGdp: 0.6,
      inflationRate: 0.05,
      trust: 0.5,
      sovereignCouponRate: 4.0,
      fxDepreciationRate10t: 0,
      turnsSinceLastDefault: 100,
      entityHoldings: 0,
      requiredIssuance: 0,
    };
    const result = computeMarketDemand(recovered);
    const scarComponent = result.components.find((c) => c.id === "defaultScar");
    expect(scarComponent?.contribution).toBe(0);
  });

  it("Japan-like profile WITH meaningful entity holdings reaches healthier demand", () => {
    const japanWithCapture: SovereignDemandSnapshot = {
      countryCode: "JP",
      currentTurn: 1000,
      debtToGdp: 2.6,
      inflationRate: 0.01,
      trust: 0.7,
      sovereignCouponRate: 1.5,
      fxDepreciationRate10t: 0,
      turnsSinceLastDefault: null,
      // Captive demand: entity holdings ~0.8x required issuance lifts demand.
      entityHoldings: 800_000_000,
      requiredIssuance: 1_000_000_000,
    };
    const synth = computeMarketDemand({
      ...japanWithCapture,
      entityHoldings: 0,
    });
    const withEntity = computeMarketDemand(japanWithCapture);
    expect(withEntity.demandRatio).toBeGreaterThan(synth.demandRatio);
  });
});
