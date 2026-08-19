/**
 * Capital-mode + supply-agreements regression pins.
 *
 * The plants work is described as "byte-identical below plants". That claim
 * does NOT hold for the contract paths, and this file exists so the deviation
 * is a decision rather than an accident.
 *
 * Trace: `computeClearingFactors` gates the contracted pre-pass and the
 * loyal-slice `offerUnits` rework on `contractedByCorpCommodity` / `sectorCorpId`.
 * turn/corporation/index.ts supplies both whenever `supplyAgreementsEnabled`
 * is on, with NO plants condition (only `producedUnitsOut` and `plantsEnabled`
 * carry one). So in CAPITAL mode with contracts on, fills move: a contracted
 * supplier is served before the loyal slice and before cheapest-first. The
 * contract is a RESERVATION, not a cap — the supplier's surplus still clears.
 *
 * The tests below pin that intended behavior with plantsEnabled OFF.
 */

import { describe, it, expect } from "vitest";
import type { CommodityType } from "@/lib/constants/commodities";
import { computeClearingFactors } from "./clearing";

const commodity = "steel" as CommodityType;
const basePrices = { steel: 100 } as unknown as Record<CommodityType, number>;
const ratios: ReadonlyMap<CommodityType, number> = new Map([[commodity, 1]]);

/** Two sectors of equal size and equal posture, so only contracts can separate them. */
function run(opts: {
  contracted?: number;
  loyalty?: [number, number];
  demand: number;
  supply: number;
  settlementOut?: Map<string, Map<CommodityType, number>>;
}) {
  const sectorCorpId = new Map([
    ["sA", "corpA"],
    ["sB", "corpB"],
  ]);
  return computeClearingFactors({
    sectors: [
      {
        sectorId: "sA",
        revenue: 10000,
        supplyRates: { [commodity]: 1 },
        posture: 0,
        brandLoyalty: opts.loyalty?.[0],
      },
      {
        sectorId: "sB",
        revenue: 10000,
        supplyRates: { [commodity]: 1 },
        posture: 0,
        brandLoyalty: opts.loyalty?.[1],
      },
    ],
    balances: new Map([[commodity, { supply: opts.supply, demand: opts.demand }]]),
    priceRatioByCommodity: ratios,
    basePrices,
    loyaltySliceEnabled: opts.loyalty != null,
    // Capital mode: plants is OFF everywhere in this file on purpose.
    plantsEnabled: false,
    sectorCorpId,
    contractedByCorpCommodity:
      opts.contracted != null
        ? new Map([["corpA", new Map([[commodity, opts.contracted]])]])
        : undefined,
    contractSettlementOut: opts.settlementOut,
  });
}

describe("clearing: contracts change numbers in CAPITAL mode (not byte-identical)", () => {
  it("serves a contracted supplier ahead of an identical uncontracted one in a glut", () => {
    // Demand well below the book, so without contracts the two identical sellers
    // split the shortfall evenly.
    const even = run({ demand: 50, supply: 1000 });
    expect(even.get("sA")!.soldFraction).toBeCloseTo(even.get("sB")!.soldFraction, 10);

    // Same book, but corpA holds a contract: its units are taken first, so its
    // fill rises above the identical seller's. This is the capital-mode deviation.
    const withContract = run({ demand: 50, supply: 1000, contracted: 40 });
    expect(withContract.get("sA")!.soldFraction).toBeGreaterThan(
      withContract.get("sB")!.soldFraction
    );
    expect(withContract.get("sA")!.soldFraction).toBeGreaterThan(even.get("sA")!.soldFraction);
  });

  it("does not blackhole a contracted supplier's surplus (additive)", () => {
    // A contract reserves 40 units for the buyer, but demand is ample. The
    // supplier's surplus above 40 still clears on the open market, so a contract
    // never drops its fill below the identical uncontracted neighbour's — the
    // ticket-1138 regression where an exclusive cap pinned fill to
    // contracted/produced.
    const withContract = run({ demand: 10000, supply: 1000, contracted: 40 });
    expect(withContract.get("sA")!.soldFraction).toBeGreaterThanOrEqual(
      withContract.get("sB")!.soldFraction - 1e-9
    );
    // Ample demand ⇒ everything offered clears for the contracted supplier too.
    expect(withContract.get("sA")!.soldFraction).toBeCloseTo(1, 6);
  });

  it("reserves contracted units before the loyal slice, not after", () => {
    // corpB is the loyal seller; corpA holds the contract. The contract pre-pass
    // runs FIRST, so the contracted seller is not squeezed out by loyalty.
    const noContract = run({ demand: 50, supply: 1000, loyalty: [0, 80] });
    const withContract = run({ demand: 50, supply: 1000, loyalty: [0, 80], contracted: 40 });
    expect(withContract.get("sA")!.soldFraction).toBeGreaterThan(
      noContract.get("sA")!.soldFraction
    );
  });

  it("still records contract settlement in capital mode", () => {
    const settlementOut = new Map<string, Map<CommodityType, number>>();
    run({ demand: 10000, supply: 1000, contracted: 40, settlementOut });
    expect(settlementOut.get("corpA")?.get(commodity)).toBeGreaterThan(0);
  });
});
