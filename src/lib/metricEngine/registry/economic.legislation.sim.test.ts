import { describe, expect, it } from "vitest";
import { tradeGrowthNode } from "./economic";
import { legislationTypes } from "@/lib/seeds/reference/legislationTypes";
import { runLegislationSim, warmup, reportTrajectory } from "../__sims__/legislationSim";
import type { NodeId } from "../types";
import type { StateMetricBaseline } from "@/lib/db/types/statePolicy";

/**
 * Legislative metric simulation — ECONOMIC category, 240 turns (the trade-Laffer).
 *
 * Law: "Federal Tariff Rate Act" (us_federal_tariff_rate). Unlike spending/policy
 * laws, a tariff law lands in the budget tax rates → the `fiscalTradeInputs` provider
 * the `economic.tradeGrowth` node reads. We compare a low-tariff control (2%) against a
 * protectionist enactment (25%): the trade-Laffer wedge (TARIFF_WEDGE_K) should pull
 * trade growth DOWN. Both runs warm from the same low-tariff state; divergence isolates
 * the tariff hike.
 */
const TURNS = 240;

const law = legislationTypes.find((l) => l._id === "us_federal_tariff_rate");

const baselineDoc: StateMetricBaseline = {
  _id: "federal",
  baselines: {},
} as unknown as StateMetricBaseline;
const external: Record<NodeId, number> = { "economic.manufacturingCompetitiveness": 60 };
const initial: Partial<Record<NodeId, number>> = { "economic.tradeGrowth": 2.5 };
const legTypeMap = new Map();

const fiscalTradeInputs = (tariff: number) => ({
  fiscalTradeInputs: {
    tariff,
    foreignCorporateTax: 15,
    forexStrength: 0,
    ftaPartnerCount: 2,
    blocMember: false,
    inflationRate: 2,
  },
});

const common = {
  nodes: [tradeGrowthNode],
  baselineDoc,
  external,
  initial,
  legTypeMap,
  turns: TURNS,
  policies: [],
};
// Warm + control at the low (baseline) tariff; the enactment raises it to 25%.
const lowTariff = fiscalTradeInputs(2);
const highTariff = fiscalTradeInputs(25);
const warm = warmup({ ...common, providers: lowTariff });
const control = runLegislationSim({ ...common, providers: lowTariff }, warm);
const enacted = runLegislationSim({ ...common, providers: highTariff }, warm);

describe("legislation sim — economic (Federal Tariff Rate Act, 240 turns)", () => {
  it("the seed tariff law exists", () => {
    expect(law, "us_federal_tariff_rate present").toBeTruthy();
  });

  it("prints the 240-turn trajectory report", () => {
    console.log(
      reportTrajectory(
        "Economic — Federal Tariff Rate Act (trade-Laffer)",
        ["economic.tradeGrowth"],
        control,
        enacted
      )
    );
    expect(true).toBe(true);
  });

  it("a protectionist tariff hike drags trade growth BELOW the low-tariff control", () => {
    const id = "economic.tradeGrowth";
    expect(
      enacted.final[id],
      `law ${enacted.final[id]} < control ${control.final[id]}`
    ).toBeLessThan(control.final[id]);
  });

  it("trade growth stays within bounds and converges", () => {
    const id = "economic.tradeGrowth";
    const v = enacted.final[id];
    expect(v, "within [-30,30]").toBeGreaterThanOrEqual(-30);
    expect(v, "within [-30,30]").toBeLessThanOrEqual(30);
    const tr = enacted.trajectory[id];
    expect(Math.abs(tr[tr.length - 1] - tr[tr.length - 2]), "converged (final step)").toBeLessThan(
      0.05
    );
  });
});
