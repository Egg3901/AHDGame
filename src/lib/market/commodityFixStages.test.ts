import { describe, expect, it } from "vitest";
import {
  COMMODITY_FIX_STAGE,
  DEMAND_SUPPLY_CAP_STAGED,
  EXTRACTABLE_STOCK_COVER_CAP_TURNS,
  RETAIL_GDP_DEMAND_SCALE_STAGED,
  RETAIL_GDP_MULTIPLIER_MAX_STAGED,
  SHORTAGE_HEADROOM_MAX_BONUS,
  commodityFixStageActive,
  demandSupplyCapForStage,
  normalizeCommodityFixStage,
  retailGdpParamsForStage,
  shortagePolicyHeadroom,
  stockCoverCapTurnsForStage,
} from "./commodityFixStages";
import { computeRetailDemandMultiplier, type CommodityType } from "@/lib/constants/commodities";

describe("commodityFixStages", () => {
  it("normalises garbage and clamps to [0, 6]", () => {
    expect(normalizeCommodityFixStage(undefined)).toBe(0);
    expect(normalizeCommodityFixStage("3")).toBe(0);
    expect(normalizeCommodityFixStage(-2)).toBe(0);
    expect(normalizeCommodityFixStage(2.9)).toBe(2);
    expect(normalizeCommodityFixStage(99)).toBe(6);
  });

  it("stage gates are cumulative", () => {
    expect(commodityFixStageActive(0, COMMODITY_FIX_STAGE.RATCHET_MOMENTUM)).toBe(false);
    expect(commodityFixStageActive(1, COMMODITY_FIX_STAGE.RATCHET_MOMENTUM)).toBe(true);
    expect(commodityFixStageActive(1, COMMODITY_FIX_STAGE.RETAIL_AMPLIFIER)).toBe(false);
    expect(commodityFixStageActive(6, COMMODITY_FIX_STAGE.EXTRACTABLE_STOCK_COVER)).toBe(true);
  });

  it("stage 2 tames the retail GDP amplifier: 4.8% growth reads 1.24, not 1.72", () => {
    const defaults = { scale: 15, max: 2 };
    expect(retailGdpParamsForStage(1, defaults)).toBe(defaults);
    expect(retailGdpParamsForStage(2, defaults)).toEqual({
      scale: RETAIL_GDP_DEMAND_SCALE_STAGED,
      max: RETAIL_GDP_MULTIPLIER_MAX_STAGED,
    });
    expect(computeRetailDemandMultiplier(4.8, 4.8)).toBe(1.72);
    expect(computeRetailDemandMultiplier(4.8, 4.8, retailGdpParamsForStage(2, defaults))).toBe(
      1.24
    );
    // a boom still clamps at the staged ceiling
    expect(computeRetailDemandMultiplier(12, 12, retailGdpParamsForStage(2, defaults))).toBe(1.3);
  });

  it("stage 3 lowers the shared final-demand ceiling to 1.25x prior supply", () => {
    expect(demandSupplyCapForStage(2, 1.5)).toBe(1.5);
    expect(demandSupplyCapForStage(3, 1.5)).toBe(DEMAND_SUPPLY_CAP_STAGED);
    expect(demandSupplyCapForStage(6, 1.5)).toBe(1.25);
  });

  it("stage 4 gives shortage headroom only to positive policy in a deep shortage", () => {
    type Balances = Map<CommodityType, { supply: number; demand: number }>;
    const short: Balances = new Map([["energy", { supply: 60, demand: 100 }]]); // 40% unmet
    const balanced: Balances = new Map([["energy", { supply: 100, demand: 100 }]]);
    const rates = { energy: 1 };
    expect(
      shortagePolicyHeadroom({ stage: 3, policyLevel: 25, supplyRates: rates, balances: short })
    ).toBe(1);
    expect(
      shortagePolicyHeadroom({ stage: 4, policyLevel: 0, supplyRates: rates, balances: short })
    ).toBe(1);
    expect(
      shortagePolicyHeadroom({ stage: 4, policyLevel: 25, supplyRates: rates, balances: balanced })
    ).toBe(1);
    // severity = (0.4 - 0.25) / 0.75 = 0.2 -> 1 + 0.1 * 0.2
    expect(
      shortagePolicyHeadroom({ stage: 4, policyLevel: 25, supplyRates: rates, balances: short })
    ).toBeCloseTo(1 + SHORTAGE_HEADROOM_MAX_BONUS * 0.2, 10);
    // half policy -> half the bonus
    expect(
      shortagePolicyHeadroom({ stage: 4, policyLevel: 12.5, supplyRates: rates, balances: short })
    ).toBeCloseTo(1 + SHORTAGE_HEADROOM_MAX_BONUS * 0.1, 10);
    // a total shortage at full policy reaches the max bonus
    const empty: Balances = new Map([["energy", { supply: 0, demand: 100 }]]);
    expect(
      shortagePolicyHeadroom({ stage: 4, policyLevel: 25, supplyRates: rates, balances: empty })
    ).toBeCloseTo(1 + SHORTAGE_HEADROOM_MAX_BONUS, 10);
  });

  it("stage 5 shortens the cover cap for extractables only", () => {
    expect(stockCoverCapTurnsForStage(4, "timber", 400)).toBe(400);
    expect(stockCoverCapTurnsForStage(5, "timber", 400)).toBe(EXTRACTABLE_STOCK_COVER_CAP_TURNS);
    expect(stockCoverCapTurnsForStage(5, "steel", 400)).toBe(400);
  });
});
