import assert from "node:assert/strict";
import {
  blendOutputGrowthSignal,
  constantPriceOutput,
  outputHistorySpanTurns,
} from "../../src/lib/metricEngine/rules/outputVolume";
import { advanceOutputGap } from "../../src/lib/metricEngine/outputGap";
import {
  advanceRevenueEma,
  computeTrailingRevenueGrowthRate,
  selectRevenueTrendBaseline,
  updateRevenueSnapshots,
  type RevenueSnapshot,
} from "../../src/lib/turn/gdpGrowth";

const TURNS_PER_YEAR = 48;
const POTENTIAL = 4;
const CASES = [
  {
    name: "rising nominal price, constant physical output",
    priceBefore: 1,
    priceAfter: 1.1,
    quantityBefore: 100,
    quantityAfter: 100,
  },
  {
    name: "falling nominal price, constant physical output",
    priceBefore: 1,
    priceAfter: 0.9,
    quantityBefore: 100,
    quantityAfter: 100,
  },
  {
    name: "constant price, rising physical output",
    priceBefore: 1,
    priceAfter: 1,
    quantityBefore: 100,
    quantityAfter: 110,
  },
  {
    name: "constant price, falling physical output",
    priceBefore: 1,
    priceAfter: 1,
    quantityBefore: 100,
    quantityAfter: 90,
  },
] as const;

type Row = {
  turn: number;
  priorSignal: number;
  physicalSignal: number | null;
  historySpan: number;
  blendedSignal: number;
  growth: number;
  gap: number;
};

function runCase(testCase: (typeof CASES)[number]): Row[] {
  let nominalEma: number | undefined;
  let physicalEma: number | undefined;
  let nominalSnapshots: RevenueSnapshot[] = [];
  let physicalSnapshots: RevenueSnapshot[] = [];
  let gap = 0;
  let previousGap = 0;
  const rows: Row[] = [];

  // Mature nominal history exists before the measurement cutover. Physical
  // history begins at cutover, which is the migration case being tested.
  for (let turn = -56; turn <= 64; turn += 1) {
    const quantityChangeTurn = testCase.quantityBefore === testCase.quantityAfter ? 0 : 24;
    const quantity = turn < quantityChangeTurn ? testCase.quantityBefore : testCase.quantityAfter;
    const price = turn < 0 ? testCase.priceBefore : testCase.priceAfter;
    const physical = constantPriceOutput(
      { sectorType: "manufacturing", producedUnits: quantity },
      turn
    )!;
    const nominal = physical * price;
    nominalEma = advanceRevenueEma(nominalEma, nominal);
    if (turn >= 0) physicalEma = advanceRevenueEma(physicalEma, physical);
    const priorSignal =
      computeTrailingRevenueGrowthRate(
        nominalEma,
        selectRevenueTrendBaseline(nominalSnapshots, turn),
        TURNS_PER_YEAR
      ) ?? 0;
    const physicalSignal =
      turn >= 0
        ? computeTrailingRevenueGrowthRate(
            physicalEma,
            selectRevenueTrendBaseline(physicalSnapshots, turn),
            TURNS_PER_YEAR
          )
        : null;
    const historySpan = turn >= 0 ? outputHistorySpanTurns(physicalSnapshots, turn) : 0;
    const blendedSignal = blendOutputGrowthSignal(priorSignal, physicalSignal, historySpan);
    const step = advanceOutputGap(gap, blendedSignal, POTENTIAL, TURNS_PER_YEAR);
    assert.equal(step.gdpGrowth, POTENTIAL + (step.gap - gap) * TURNS_PER_YEAR);
    previousGap = gap;
    gap = step.gap;
    if ([0, 7, 8, 9, 24, 47, 48, 49, 64].includes(turn)) {
      rows.push({
        turn,
        priorSignal,
        physicalSignal,
        historySpan,
        blendedSignal,
        growth: step.gdpGrowth,
        gap,
      });
    }
    if (turn === 8) assert.equal(blendedSignal, priorSignal);
    if (turn === 48) assert.equal(blendedSignal, physicalSignal);
    if (turn > 48) assert.equal(blendedSignal, physicalSignal);
    if (turn >= 48 && testCase.quantityBefore === testCase.quantityAfter)
      assert.equal(blendedSignal, 0);
    if (turn === 48 && testCase.quantityBefore !== testCase.quantityAfter)
      assert.equal(
        Math.sign(blendedSignal),
        Math.sign(testCase.quantityAfter - testCase.quantityBefore)
      );
    nominalSnapshots = updateRevenueSnapshots(nominalSnapshots, turn, nominalEma);
    if (turn >= 0)
      physicalSnapshots = updateRevenueSnapshots(physicalSnapshots, turn, physicalEma!);
  }
  assert.notEqual(gap, previousGap);
  return rows;
}

const result = Object.fromEntries(CASES.map((testCase) => [testCase.name, runCase(testCase)]));
console.log(
  JSON.stringify(
    {
      semantics:
        "production output-volume blend + output-gap identity; synthetic public-safe signals",
      result,
    },
    null,
    2
  )
);
