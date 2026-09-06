/** Issue #1470: deterministic measurement A/B, with no database or policy writes. */
import assert from "node:assert/strict";
import { TURNS_PER_YEAR } from "@/lib/constants/turnTime";
import { constantPriceOutput } from "@/lib/metricEngine/rules/outputVolume";
import {
  sectorGrowthNode,
  type SectorRevenueTaxPayload,
} from "@/lib/metricEngine/registry/economic";
import { advanceOutputGap } from "@/lib/metricEngine/outputGap";
import {
  advanceRevenueEma,
  selectRevenueTrendBaseline,
  updateRevenueSnapshots,
  type RevenueSnapshot,
} from "@/lib/turn/gdpGrowth";

const cases = ["flat", "price-fall", "output-fall", "price-recovery", "output-recovery"] as const;
const rows: Array<Record<string, string | number>> = [];
for (const scenario of cases) {
  let nominalEma: number | undefined;
  let outputEma: number | undefined;
  let nominalSnapshots: RevenueSnapshot[] = [];
  let outputSnapshots: RevenueSnapshot[] = [];
  let oldGap = 0;
  let newGap = 0;
  for (let turn = 0; turn <= 144; turn++) {
    const stressed = turn >= 48 && !(scenario.endsWith("recovery") && turn >= 96);
    const quantity = stressed && scenario.startsWith("output") ? 80 : 100;
    const price = stressed && scenario.startsWith("price") ? 0.8 : 1;
    const output = constantPriceOutput(
      { sectorType: "manufacturing", producedUnits: quantity },
      turn
    )!;
    nominalEma = advanceRevenueEma(nominalEma, output * price);
    outputEma = advanceRevenueEma(outputEma, output);
    const payload: SectorRevenueTaxPayload = {
      owned: [],
      unowned: [],
      countryId: "US",
      federalSalesTax: 0,
      stateSalesTax: 6,
      plantsEnabled: true,
      revenueEmaNow: nominalEma,
      revenueTrendBaseline: selectRevenueTrendBaseline(nominalSnapshots, turn),
    };
    const compute = (p: SectorRevenueTaxPayload) =>
      sectorGrowthNode.compute!({
        current: {},
        prev: {},
        prevSimBaseline: {},
        spending: {},
        policyValue: NaN,
        providers: { sectorRevenueTax: p },
      });
    const oldSignal = compute(payload);
    const newSignal = compute({
      ...payload,
      outputEmaNow: outputEma,
      outputTrendBaseline: selectRevenueTrendBaseline(outputSnapshots, turn),
    });
    const oldStep = advanceOutputGap(oldGap, oldSignal, 2, TURNS_PER_YEAR);
    const newStep = advanceOutputGap(newGap, newSignal, 2, TURNS_PER_YEAR);
    oldGap = oldStep.gap;
    newGap = newStep.gap;
    nominalSnapshots = updateRevenueSnapshots(nominalSnapshots, turn, nominalEma);
    outputSnapshots = updateRevenueSnapshots(outputSnapshots, turn, outputEma);
    if (turn >= 48 && scenario.startsWith("price")) assert(Math.abs(newSignal) < 1e-9);
    if (scenario.startsWith("output") || scenario === "flat")
      assert(Math.abs(newSignal - oldSignal) < 1e-9);
    if ([48, 72, 96, 120, 144].includes(turn))
      rows.push({
        scenario,
        turn,
        oldSignal: +oldSignal.toFixed(3),
        newSignal: +newSignal.toFixed(3),
        oldGrowth: +oldStep.gdpGrowth.toFixed(3),
        newGrowth: +newStep.gdpGrowth.toFixed(3),
      });
  }
}
console.log(
  JSON.stringify(
    {
      semantics:
        "Exogenous quantity/price shocks through production helpers, not a full-world simulation",
      rows,
    },
    null,
    2
  )
);
