import { describe, expect, it } from "vitest";
import type { Db } from "mongodb";
import { financialCrisisSignal, loadFinancialCrisisSignal } from "./financialCrisisPressure";

const metric = (value: number | null) => ({ value });

describe("financial crisis opening pressure", () => {
  it("keeps a liquid, moderately leveraged economy below the crash gate", () => {
    const signal = financialCrisisSignal({
      creditToM2: metric(0.5),
      corporateNoHolderBondShare: metric(0.05),
      sovereignNoHolderBondShare: metric(0.03),
      organicTwoSidedListingShare: metric(0.85),
      lossMakingShare: metric(0.12),
    });

    expect(signal.pressure).toBe(0);
    expect(signal.observations).toBe(5);
  });

  it("opens a severe crash from live leverage, funding, liquidity, and solvency stress", () => {
    const signal = financialCrisisSignal({
      creditToM2: metric(1.1),
      corporateNoHolderBondShare: metric(0.65),
      sovereignNoHolderBondShare: metric(0.5),
      organicTwoSidedListingShare: metric(0.15),
      lossMakingShare: metric(0.65),
    });

    expect(signal.pressure).toBeGreaterThanOrEqual(80);
    expect(signal.openingTrackDeltas.financialFragility).toBeGreaterThan(40);
    expect(signal.openingTrackDeltas.bankSolvency).toBeLessThan(-20);
    expect(signal.openingTrackDeltas.marketConfidence).toBeLessThan(-20);
  });

  it("can produce an intermediate shock rather than a binary historical replay", () => {
    const signal = financialCrisisSignal({
      creditToM2: metric(0.8),
      corporateNoHolderBondShare: metric(0.3),
      sovereignNoHolderBondShare: metric(0.12),
      organicTwoSidedListingShare: metric(0.55),
      lossMakingShare: metric(0.35),
    });

    expect(signal.pressure).toBeGreaterThan(20);
    expect(signal.pressure).toBeLessThan(60);
  });

  it("does not manufacture risk from missing observations", () => {
    expect(financialCrisisSignal({})).toEqual({
      pressure: 0,
      observations: 0,
      openingTrackDeltas: {
        financialFragility: 0,
        liquidityStress: 0,
        bankSolvency: 0,
        contagion: 0,
        marketConfidence: 0,
        sovereignSpreads: 0,
      },
    });
  });

  it("loads only the latest snapshot at or before the current turn", async () => {
    let seenFilter: unknown;
    let seenOptions: unknown;
    const db = {
      collection() {
        return {
          async findOne(filter: unknown, options: unknown) {
            seenFilter = filter;
            seenOptions = options;
            return {
              turn: 40,
              firms: { lossMakingShare: metric(0.65) },
              money: { creditToM2: metric(1.1) },
              securities: {
                corporateNoHolderBondShare: metric(0.65),
                sovereignNoHolderBondShare: metric(0.5),
                organicTwoSidedListingShare: metric(0.15),
              },
            };
          },
        };
      },
    } as unknown as Db;

    const signal = await loadFinancialCrisisSignal(db, 42);

    expect(seenFilter).toEqual({ turn: { $lte: 42 } });
    expect(seenOptions).toMatchObject({ sort: { turn: -1 } });
    expect(signal.pressure).toBeGreaterThanOrEqual(80);
  });
});
