import { describe, expect, it } from "vitest";
import {
  revenueBasisPerLot,
  lotInputCost,
  lotProductionCost,
  lotPriceBand,
  contractLotsThisTurn,
  defaultFactoryAllocation,
  awardFactoryAllocation,
  normalizeGrade,
  GRADE_PRICE_SCALE,
  MIN_CONTRACT_MARGIN,
  TARGET_SUPPLIER_MARGIN,
  lotCostIndex,
  DEFENCE_FACTORY_SLOTS_PER_PLANT,
} from "./defenceLotEconomics";
import { rawLotsFromSector } from "./arsenal";
import { SECTOR_STRATEGIES } from "@/lib/constants/sectorStrategies";

describe("revenueBasisPerLot", () => {
  // The whole cost model rests on this being the exact inverse of the production model. If
  // the two ever drift, a lot costs one thing to build and another thing to count.
  it("is the exact inverse of the lot production identity", () => {
    const basis = revenueBasisPerLot("munitions")!;
    expect(rawLotsFromSector({ strategyId: "munitions", revenue: basis })).toBeCloseTo(1, 9);
  });

  it("refuses a line that supplies nothing", () => {
    // `cyber` makes electronics and software, not materiel.
    expect(revenueBasisPerLot("cyber")).not.toBeNull();
    expect(revenueBasisPerLot("not_a_strategy")).toBeNull();
  });
});

describe("lotProductionCost", () => {
  // The live US figure, from prod: anchoredGdp x LOT_COST_SHARE x scale at the reworked
  // MATERIEL_SHARE_OF_UNIT_COST of 0.20.
  const PRICE = 219_285_034;

  it("is a margin-derived share of what the lot sells for", () => {
    for (const id of ["standard", "heavy_armor", "munitions", "aerospace"]) {
      const cost = lotProductionCost(id, PRICE)!;
      expect(cost).toBeCloseTo(PRICE * (1 - TARGET_SUPPLIER_MARGIN), 6);
    }
  });

  // THE ticket #1134 regression, from `financialTxLog` turn 219 on the production world. A US
  // air lot was priced 383,748,809 against a build cost of 1,091, so 99.9997% of the contract
  // was margin and the delivery was a transfer of the national appropriation into one
  // corporation's cash. Cost is now derived FROM price, so a four-figure build cost against a
  // nine-figure lot is no longer representable.
  it("cannot leave a nine-figure lot costing four figures to build", () => {
    const cost = lotProductionCost("aerospace", 383_748_809)!;
    expect(cost).toBeGreaterThan(1_091 * 100_000);
    expect(cost / 383_748_809).toBeCloseTo(0.85, 6);
    // The supplier's take is a normal industrial return, not the whole appropriation.
    expect((383_748_809 - cost) / 383_748_809).toBeCloseTo(0.15, 6);
  });

  // Strategy no longer sets the LEVEL of cost, only how hard the market squeezes it. Before
  // #1134 the level swung 40x across production lines for no reason a player could see.
  it("does not let the production line change the level of cost", () => {
    const calm = ["standard", "heavy_armor", "munitions", "aerospace"].map(
      (id) => lotProductionCost(id, PRICE)!
    );
    for (const cost of calm) expect(cost).toBeCloseTo(calm[0], 6);
  });

  // Buy-sell symmetry: the bill prices through the same realization clamp the revenue side
  // uses, so a world shortage cannot drive every defence contract underwater on its own.
  it("damps and clamps a price shock rather than passing it through linearly", () => {
    const base = lotInputCost("heavy_armor")!;
    const shock = lotInputCost("heavy_armor", new Map([["steel", 4]]))!;
    expect(shock).toBeGreaterThan(base);
    expect(shock).toBeLessThan(base * 4);
  });

  it("moves cost with the market, within the index clamp", () => {
    const calm = lotProductionCost("heavy_armor", PRICE)!;
    const dear = lotProductionCost("heavy_armor", PRICE, new Map([["steel", 4]]))!;
    expect(dear).toBeGreaterThan(calm);
    expect(dear).toBeLessThanOrEqual(PRICE * (1 - TARGET_SUPPLIER_MARGIN) * 1.5);
    expect(lotCostIndex("heavy_armor")).toBeCloseTo(1, 9);
  });

  it("returns null for a line that builds no materiel, or an unusable price", () => {
    expect(lotProductionCost("not_a_strategy", PRICE)).toBeNull();
    expect(lotProductionCost("heavy_armor", 0)).toBeNull();
    expect(lotProductionCost("heavy_armor", -1)).toBeNull();
  });
});

// Ticket #1134 follow-up. The 1953 world's live commodity book is era-scaled (steel 11.47,
// not 800), which makes `revenueBasisPerLot` reading the MODERN table look like a bug. It is
// not, and these two tests are here so the next person to notice does not "fix" it.
describe("the lot unit's base-price basis", () => {
  const strategies = ["standard", "heavy_armor", "munitions", "aerospace"] as const;

  // The invariant that matters: cost per lot and lots produced must be counted in the same
  // unit. Break it and the delivery burn is wrong by the era scale, which is exactly the
  // denomination mismatch between the ends of the price band that this ticket closed.
  it("is shared with rawLotsFromSector, so a lot means one thing on both sides", () => {
    for (const strategyId of strategies) {
      const basis = revenueBasisPerLot(strategyId)!;
      const lotsFromOneRevenue = rawLotsFromSector({ strategyId, revenue: 1 });
      expect(basis * lotsFromOneRevenue).toBeCloseTo(1, 9);
    }
  });

  // Why era-scaling both sides would be a no-op in money: the base price cancels out of the
  // bill. `computeInputsCost` charges `units x unitPrice` with `units = revenue x rate / base`
  // and `unitPrice = base x realization`, so a plant's whole input spend is
  // `revenue x sum(rate x realization)` on any table. Scaling the basis only redefines how
  // finely a lot is diced, and would make every unit's materiel load ~70x cheaper in real
  // terms because `lotsRequired` is a fixed function of archetype cost.
  it("cancels out of a plant's total input bill", () => {
    const revenue = 870_987;
    for (const strategyId of strategies) {
      const perLot = lotInputCost(strategyId)!;
      const lots = rawLotsFromSector({ strategyId, revenue });
      const demandShare = SECTOR_STRATEGIES.defense
        .find((s) => s.id === strategyId)!
        .demand as Record<string, number>;
      const shareSum = Object.values(demandShare).reduce((a, b) => a + b, 0);
      expect(lots * perLot).toBeCloseTo(revenue * shareSum, 3);
    }
  });
});

describe("lotPriceBand", () => {
  // Cost is derived from price now, so a realistic band input is `anchor x (1 - margin)`.
  const ANCHOR = 10_000;
  const productionCost = ANCHOR * (1 - TARGET_SUPPLIER_MARGIN);

  it("never lets a contract be written below the cost of building it", () => {
    const band = lotPriceBand({ anchorPrice: 1, productionCost, grade: 2 })!;
    expect(band.floor).toBeGreaterThan(productionCost);
    expect(band.floor).toBeGreaterThanOrEqual(
      Math.ceil(productionCost * (1 + MIN_CONTRACT_MARGIN))
    );
    // A collapsed anchor cannot produce a band that undercuts the floor.
    expect(band.ceiling).toBeGreaterThanOrEqual(band.floor);
  });

  // The GDP anchor is the designed price and the working ceiling: it is the tighter of the
  // two bounds whenever the commodity market is calm.
  it("caps the price at the grade-scaled GDP anchor in a calm market", () => {
    const band = lotPriceBand({ anchorPrice: ANCHOR, productionCost, grade: 2 })!;
    expect(band.ceiling).toBe(ANCHOR);
  });

  // The backstop, for the day the cost model is changed or mis-seeded. Whatever happens, a
  // price cannot sit orders of magnitude above what building the lot consumed. That is the
  // failure mode ticket #1134 was raised for.
  it("caps the price at twice cost even when the anchor is absurd", () => {
    const band = lotPriceBand({ anchorPrice: 383_748_809, productionCost: 1_091, grade: 2 })!;
    expect(band.ceiling).toBe(2_182);
    expect(band.ceiling).toBeLessThan(383_748_809 / 100_000);
  });

  // Leaving the price blank quotes the designed anchor: grossing the cost back up by the same
  // margin it was derived with returns exactly the figure it came from.
  it("defaults to the designed anchor price in a calm market", () => {
    const band = lotPriceBand({ anchorPrice: ANCHOR, productionCost, grade: 2 })!;
    expect(band.suggested).toBe(ANCHOR);
    expect(band.suggested).toBeGreaterThanOrEqual(band.floor);
    expect(band.suggested).toBeLessThanOrEqual(band.ceiling);
  });

  // THE live case, from `financialTxLog` turn 219 on the production world. A US air lot was
  // priced 383,748,809 against a build cost of 1,091, so 99.9997% of the contract was margin
  // and the delivery was a transfer of the national appropriation into one corporation's cash.
  // Under the reworked model the price stays the designed figure and the COST rises to meet
  // it, so the appropriation converts into materiel rather than into a cash balance.
  it("leaves the supplier a normal industrial return on the live US lot", () => {
    const anchorPrice = 219_285_034; // the live US lot at MATERIEL_SHARE_OF_UNIT_COST 0.20
    const cost = lotProductionCost("aerospace", anchorPrice)!;
    const band = lotPriceBand({ anchorPrice, productionCost: cost, grade: 2 })!;

    expect(Math.round(cost)).toBe(186_392_279);
    expect(band.floor).toBe(208_759_353);
    expect(band.suggested).toBe(219_285_034);
    expect(band.ceiling).toBe(219_285_034);

    // The supplier's take across the whole negotiable band is a real but ordinary return,
    // nothing like the 99.9997% the live world paid.
    expect((band.ceiling - cost) / band.ceiling).toBeCloseTo(0.15, 3);
    expect((band.floor - cost) / band.floor).toBeGreaterThan(0.1);
    expect((band.ceiling - cost) / band.ceiling).toBeLessThan(0.2);
  });

  // Suggestion #292. Grade is one dial with two ends: cheap mass costs less to build AND
  // prices lower, premium costs more AND prices higher, so both doctrines are real choices.
  it("scales both ends of the band with grade", () => {
    const cheap = lotPriceBand({ anchorPrice: 10_000, productionCost, grade: 0 })!;
    const premium = lotPriceBand({ anchorPrice: 10_000, productionCost, grade: 3 })!;
    expect(cheap.ceiling).toBeLessThan(premium.ceiling);
    expect(cheap.floor).toBeLessThan(premium.floor);
    expect(cheap.productionCost).toBeLessThan(premium.productionCost);
  });

  it("refuses an unusable anchor rather than quoting a free lot", () => {
    expect(lotPriceBand({ anchorPrice: 0, productionCost, grade: 2 })).toBeNull();
    expect(lotPriceBand({ anchorPrice: -1, productionCost, grade: 2 })).toBeNull();
  });

  it("clamps a grade outside the arsenal's 0..3 band", () => {
    expect(normalizeGrade(9)).toBe(3);
    expect(normalizeGrade(-4)).toBe(0);
    expect(normalizeGrade(undefined)).toBe(3);
  });
});

describe("factory allocation", () => {
  // The default MUST reproduce the pre-slot even split exactly, or every live contract's
  // throughput changes the turn this ships.
  it("defaults to the split a contract already had", () => {
    const raw = 8;
    for (const componentCount of [1, 2]) {
      const assigned = defaultFactoryAllocation(componentCount, DEFENCE_FACTORY_SLOTS_PER_PLANT);
      expect(contractLotsThisTurn(raw, assigned)).toBeCloseTo(raw / componentCount, 9);
    }
  });

  it("takes only what is free when the plant is already committed", () => {
    expect(defaultFactoryAllocation(1, 1)).toBe(1);
    expect(defaultFactoryAllocation(1, 0)).toBe(0);
  });

  // Ticket #1134: NatCorp CEOs are vacant, so a split default on a two-domain plant
  // would leave half the lines idle for the life of the order.
  it("gives state industry every free line at award", () => {
    expect(awardFactoryAllocation({ componentCount: 2, freeSlots: 4, stateOwned: true })).toBe(4);
    expect(awardFactoryAllocation({ componentCount: 2, freeSlots: 4, stateOwned: false })).toBe(2);
    expect(awardFactoryAllocation({ componentCount: 1, freeSlots: 1, stateOwned: true })).toBe(1);
  });

  it("scales throughput with the lines assigned", () => {
    expect(contractLotsThisTurn(8, 4)).toBe(8);
    expect(contractLotsThisTurn(8, 2)).toBe(4);
    expect(contractLotsThisTurn(8, 0)).toBe(0);
  });

  // The double-booking this model exists to stop: two contracts on one plant can no longer
  // each take the whole thing and be paid twice for output built once.
  it("cannot let a plant's contracts sum past its total output", () => {
    const raw = 8;
    const a = contractLotsThisTurn(raw, 3);
    const b = contractLotsThisTurn(raw, DEFENCE_FACTORY_SLOTS_PER_PLANT - 3);
    expect(a + b).toBeCloseTo(raw, 9);
  });
});
