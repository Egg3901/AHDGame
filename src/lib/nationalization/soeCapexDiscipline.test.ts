import { describe, it, expect } from "vitest";
import { ObjectId } from "mongodb";
import type { Corporation, CorporateSector } from "@/lib/db/types";
import { coverableSoeShortfallAnchor } from "./soeOperations";
import { TURNS_PER_DAY } from "@/lib/constants/turnTime";
import type { CurrencyCode } from "@/lib/constants/currencies";

/**
 * P3b — SOE capex discipline.
 *
 * The treasury backs an SOE's OPERATING loss. Under plants it must not also
 * back the cash a director drained into build orders, or capacity is free for
 * every state enterprise in the game.
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

describe("coverableSoeShortfallAnchor", () => {
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

  it("does NOT comp an SOE that drained its cash into a huge fresh build order", () => {
    // Profitable operations (margin 20 ⇒ positive per-turn result), but the
    // corp is $5M in the hole because it just ordered a very large plant.
    const covered = coverableSoeShortfallAnchor({
      corporation: makeCorp(),
      sectors: [makeSector(240_000, 20)],
      shortfallAnchor: 5_000_000,
      corpOverheadAnchor: 0,
      fxByCurrency: FX,
      plantsEnabled: true,
    });
    expect(covered).toBe(0);
  });

  it("covers exactly the operating loss and leaves the build-order residual", () => {
    // Overhead swamps the sector's operating profit, so there IS a real
    // operating loss — but it is far smaller than the total hole.
    const corporation = {
      ...makeCorp(),
      marketingBudget: 0,
      logisticsBudget: 0,
      ceoSalary: 0,
    } as Corporation;
    const revenue = 240_000;
    const marginPct = 20;
    const overheadAnchor = 480_000; // daily, ₳
    const expectedLossPerTurn = (overheadAnchor - revenue * (marginPct / 100)) / TURNS_PER_DAY;

    const covered = coverableSoeShortfallAnchor({
      corporation,
      sectors: [makeSector(revenue, marginPct)],
      shortfallAnchor: 5_000_000,
      corpOverheadAnchor: overheadAnchor,
      fxByCurrency: FX,
      plantsEnabled: true,
    });
    expect(covered).toBeCloseTo(expectedLossPerTurn, 6);
    expect(covered).toBeLessThan(5_000_000);
  });

  it("never covers more than the hole itself", () => {
    const covered = coverableSoeShortfallAnchor({
      corporation: makeCorp(),
      sectors: [makeSector(240_000, 20)],
      shortfallAnchor: 10,
      corpOverheadAnchor: 10_000_000,
      fxByCurrency: FX,
      plantsEnabled: true,
    });
    expect(covered).toBe(10);
  });
  it("reads the REALIZED margin under plants, not the frozen seed constant", () => {
    // `profitMargin` is a seeded constant (12 for every state enterprise in the
    // world); under plants the turn processor derives the real one and persists
    // it as `effectiveProfitMargin`. Reading the constant reported a healthy
    // profit for an enterprise running at a large physical loss, so the
    // treasury covered nothing and the SOE carried the loss forever — the
    // whole 3 → 51 insolvency regression in the plants A/B.
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
    // the enterprise. `derivedMarginPct` excludes growth/build spend by
    // construction, so widening the margin read cannot widen this.
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
    });
    expect(covered).toBeCloseTo(operatingLossPerTurn, 6);
    expect(covered).toBeLessThan(500_000_000);
  });
});
