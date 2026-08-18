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
  DEFENCE_FACTORY_SLOTS_PER_PLANT,
} from "./defenceLotEconomics";
import { rawLotsFromSector } from "./arsenal";

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
  it("is positive for every line that can hold a contract", () => {
    for (const id of ["standard", "heavy_armor", "munitions"]) {
      expect(lotProductionCost(id)!).toBeGreaterThan(0);
    }
  });

  it("carries overhead on top of the commodity bill", () => {
    expect(lotProductionCost("heavy_armor")!).toBeGreaterThan(lotInputCost("heavy_armor")!);
  });

  // Buy-sell symmetry: the bill prices through the same realization clamp the revenue side
  // uses, so a world shortage cannot drive every defence contract underwater on its own.
  it("damps and clamps a price shock rather than passing it through linearly", () => {
    const base = lotInputCost("heavy_armor")!;
    const shock = lotInputCost("heavy_armor", new Map([["steel", 4]]))!;
    expect(shock).toBeGreaterThan(base);
    expect(shock).toBeLessThan(base * 4);
  });

  it("returns null for a line that builds no materiel", () => {
    expect(lotProductionCost("not_a_strategy")).toBeNull();
  });
});

describe("lotPriceBand", () => {
  const productionCost = 100;

  it("never lets a contract be written below the cost of building it", () => {
    const band = lotPriceBand({ anchorPrice: 1, productionCost, grade: 2 })!;
    expect(band.floor).toBeGreaterThan(productionCost);
    expect(band.floor).toBeGreaterThanOrEqual(
      Math.ceil(productionCost * (1 + MIN_CONTRACT_MARGIN))
    );
    // A collapsed anchor cannot produce a band that undercuts the floor.
    expect(band.ceiling).toBeGreaterThanOrEqual(band.floor);
  });

  // THE exploit guard on the price lever: without a ceiling a minister with an interest in the
  // supplier writes a contract at any number they like and the appropriation is a cash tap.
  it("caps the price at the grade-scaled GDP anchor", () => {
    const band = lotPriceBand({ anchorPrice: 10_000, productionCost, grade: 2 })!;
    expect(band.ceiling).toBe(Math.round(10_000 * GRADE_PRICE_SCALE[2]));
  });

  it("defaults to the anchor, which is what every contract was priced at before", () => {
    const band = lotPriceBand({ anchorPrice: 10_000, productionCost, grade: 2 })!;
    expect(band.suggested).toBe(10_000);
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
