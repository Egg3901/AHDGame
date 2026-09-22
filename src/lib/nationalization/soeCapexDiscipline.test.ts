import { describe, it, expect } from "vitest";
import { ObjectId } from "mongodb";
import type { Corporation, CorporateSector } from "@/lib/db/types";
import { coverableSoeShortfallAnchor, estimateSoeOperatingLossAnchor } from "./soeOperations";
import { TURNS_PER_DAY } from "@/lib/constants/turnTime";
import type { CurrencyCode } from "@/lib/constants/currencies";

/**
 * P3b — SOE capex discipline on the REALIZED-loss contract (#2043).
 *
 * The treasury backs an SOE's realized OPERATING loss for the turn
 * (`CorpSnapshot.income`, the figure that actually moved `liquidCapital`).
 * Under plants it must not also back the cash a director drained into build
 * orders, or capacity is free for every state enterprise in the game.
 *
 * The margin estimator survives only as an explicit fallback when no realized
 * snapshot is available — it is blind to upkeep/compliance/growth by
 * construction, so preferring it re-created the #2043 under-cover.
 */

const CORP_ID = new ObjectId();

function makeCorp(): Corporation {
  return {
    _id: CORP_ID,
    name: "Gosplan Steel",
    countryId: "US",
    countryOwnerId: "US",
    sectorType: "manufacturing",
    liquidCapital: 0,
    createdAt: new Date(),
  } as unknown as Corporation;
}

/** A sector that runs at a small per-turn operating LOSS (margin below 0 after costs). */
function makeSector(revenue: number, marginPct: number): CorporateSector {
  return {
    _id: new ObjectId(),
    corporationId: CORP_ID,
    stateId: "US-CA",
    countryId: "US",
    sectorType: "manufacturing",
    revenue,
    realizedRevenue: revenue,
    profitMargin: marginPct,
    currentGrowthCost: 0,
    createdAt: new Date(),
  } as unknown as CorporateSector;
}

/** No FX rows: every currency passes through at rate 1 (₳-on-disk). */
const FX = new Map<CurrencyCode, number>();

describe("coverableSoeShortfallAnchor (realized-loss contract)", () => {
  it("covers the whole hole below plants (unchanged behaviour)", () => {
    const covered = coverableSoeShortfallAnchor({
      corporation: makeCorp(),
      sectors: [makeSector(240_000, 20)],
      shortfallAnchor: 5_000_000,
      corpOverheadAnchor: 0,
      fxByCurrency: FX,
      plantsEnabled: false,
    });
    expect(covered).toBe(5_000_000);
  });

  it("covers exactly this turn's realized loss and leaves the build-order residual", () => {
    // Ordinary realized operating loss, far smaller than the total hole (the
    // rest is outstanding build spend). The treasury pays the turn's loss and
    // not one unit more.
    const covered = coverableSoeShortfallAnchor({
      corporation: makeCorp(),
      sectors: [makeSector(240_000, 20)],
      shortfallAnchor: 5_000_000,
      corpOverheadAnchor: 0,
      fxByCurrency: FX,
      plantsEnabled: true,
      realizedLossAnchor: 400_000,
    });
    expect(covered).toBe(400_000);
  });

  it("DISCRIMINATOR (#2043): an upkeep-heavy loss the margin estimate cannot see is still covered", () => {
    // The estimator sees only operating-scope costs: margin −2 ⇒ a tiny
    // estimated loss. The realized snapshot carries the full cash drain
    // (upkeep + compliance + growth included), 25× larger. The realized leg
    // must win — the estimate path is what left the Soviet construction
    // enterprise negative for 120 consecutive turns.
    const sector = makeSector(240_000, -2);
    const shortfall = 5_000_000;
    const estimated = estimateSoeOperatingLossAnchor({
      corporation: makeCorp(),
      sectors: [sector],
      corpOverheadAnchor: 0,
      fxByCurrency: FX,
    });
    expect(estimated).toBeGreaterThan(0);
    expect(estimated).toBeLessThan(500_000);

    const realizedLoss = 4_000_000;
    const covered = coverableSoeShortfallAnchor({
      corporation: makeCorp(),
      sectors: [sector],
      shortfallAnchor: shortfall,
      corpOverheadAnchor: 0,
      fxByCurrency: FX,
      plantsEnabled: true,
      realizedLossAnchor: realizedLoss,
    });
    expect(covered).toBe(realizedLoss);
    expect(covered).toBeGreaterThan(estimated * 10);
  });

  it("does NOT comp an SOE that drained its cash into a huge fresh build order", () => {
    // Profitable operations (no realized loss), but the corp is $5M in the
    // hole because it just ordered a very large plant.
    const covered = coverableSoeShortfallAnchor({
      corporation: makeCorp(),
      sectors: [makeSector(240_000, 20)],
      shortfallAnchor: 5_000_000,
      corpOverheadAnchor: 0,
      fxByCurrency: FX,
      plantsEnabled: true,
      realizedLossAnchor: 0,
    });
    expect(covered).toBe(0);
  });

  it("never covers more than the hole itself", () => {
    const covered = coverableSoeShortfallAnchor({
      corporation: makeCorp(),
      sectors: [makeSector(240_000, 20)],
      shortfallAnchor: 10,
      corpOverheadAnchor: 10_000_000,
      fxByCurrency: FX,
      plantsEnabled: true,
      realizedLossAnchor: 1_000_000,
    });
    expect(covered).toBe(10);
  });

  it("falls back to the margin estimate only when no realized loss is supplied", () => {
    // `profitMargin` is a seeded constant (12 for every state enterprise in the
    // world); under plants the turn processor derives the real one and persists
    // it as `effectiveProfitMargin`. The fallback still reads the derived
    // margin — it is only the upkeep-blind scope that makes it a fallback.
    const sector = {
      ...makeSector(240_000, 12),
      effectiveProfitMargin: -52,
    } as unknown as CorporateSector;
    const expectedLossPerTurn = (240_000 * 0.52) / TURNS_PER_DAY;

    const covered = coverableSoeShortfallAnchor({
      corporation: makeCorp(),
      sectors: [sector],
      shortfallAnchor: 5_000_000,
      corpOverheadAnchor: 0,
      fxByCurrency: FX,
      plantsEnabled: true,
    });
    expect(covered).toBeCloseTo(expectedLossPerTurn, 6);

    // The frozen constant alone would have reported a PROFIT and covered 0.
    expect(
      coverableSoeShortfallAnchor({
        corporation: makeCorp(),
        sectors: [makeSector(240_000, 12)],
        shortfallAnchor: 5_000_000,
        corpOverheadAnchor: 0,
        fxByCurrency: FX,
        plantsEnabled: true,
      })
    ).toBe(0);
  });

  it("ANTI-EXPLOIT: a realized-margin loss still cannot fund a build order", () => {
    // Loss-making operations AND a giant build order. The treasury pays for the
    // operating loss and not one unit more — the residual (the build) stays on
    // the enterprise. CIP never enters cover math, so widening the loss basis
    // to the realized figure cannot widen WHAT is coverable, only make the
    // operating half honest.
    const sector = {
      ...makeSector(240_000, 12),
      effectiveProfitMargin: -52,
    } as unknown as CorporateSector;
    const operatingLossPerTurn = (240_000 * 0.52) / TURNS_PER_DAY;
    const covered = coverableSoeShortfallAnchor({
      corporation: makeCorp(),
      sectors: [sector],
      shortfallAnchor: 500_000_000, // the enterprise queued an enormous plant
      corpOverheadAnchor: 0,
      fxByCurrency: FX,
      plantsEnabled: true,
      realizedLossAnchor: operatingLossPerTurn,
    });
    expect(covered).toBeCloseTo(operatingLossPerTurn, 6);
    expect(covered).toBeLessThan(500_000_000);
  });
});
