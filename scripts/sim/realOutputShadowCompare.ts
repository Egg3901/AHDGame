/**
 * Issue #1470 acceptance item 1 deterministic comparison harness.
 *
 * Compares the live nominal revenue signal against the constant-price
 * real-output shadow under shocks that touch only prices or FX, across two
 * eras (1953-default reconstruction and the modern era). Pure: it uses only
 * the production signal helpers and the output-gap integrator, and reads or
 * writes no database. It never enables the shadow flag and never points at
 * live data.
 *
 * Run: npx tsx scripts/sim/realOutputShadowCompare.ts
 * The JSONL rows are print-queue ready for the worldsim comparison pass
 * (acceptance item 4): each row carries era, scenario, turn, and both prints.
 */

import { TURNS_PER_YEAR } from "@/lib/constants/turnTime";
import { advanceOutputGap } from "@/lib/metricEngine/outputGap";
import {
  computeConstantPriceOutputGrowthRate,
  computeRealizedRevenueGrowthRate,
  realOutputShadowDivergence,
  SECTOR_SIGNAL_MIN,
} from "@/lib/turn/gdpGrowth";

type Era = { id: string; potential: number };
const ERAS: Era[] = [
  // Reconstruction: high supply-side trend, volatile demand.
  { id: "1953-default", potential: 5.5 },
  // Modern steady state: trend near the neutral 2%.
  { id: "modern", potential: 2.0 },
];

type ShockStep = { units: number; price: number };
type Scenario = { id: string; steps: (turn: number) => ShockStep };

const FLAT = 1000;
const SCENARIOS: Scenario[] = [
  {
    id: "price-only-crash",
    steps: (turn) => ({ units: FLAT, price: turn < 8 ? 1.0 : 0.7 }),
  },
  {
    id: "fx-only-restatement",
    // Local revenue flat at 1000; the anchor restatement drifts 0.2%/turn,
    // the ticket #1084 jig, applied here as a slow bleed for 8 turns.
    steps: (turn) => ({ units: FLAT, price: turn < 8 ? 1.0 : 1.0 / (1 + 0.002 * (turn - 7)) }),
  },
  {
    id: "physical-contraction",
    steps: (turn) => ({ units: turn < 8 ? FLAT : 800, price: 1.0 }),
  },
  {
    id: "recovery",
    steps: (turn) => ({ units: turn < 8 ? 800 : 920, price: 1.0 }),
  },
  {
    id: "stagflation",
    steps: (turn) => ({ units: turn < 8 ? FLAT : 950, price: turn < 8 ? 1.0 : 1.1 }),
  },
];

type Row = {
  era: string;
  scenario: string;
  turn: number;
  revenue: number;
  units: number;
  nominal: number | null;
  real: number | null;
  divergence: number | null;
  gapNominal: number;
  gapReal: number;
};

function runScenario(era: Era, scenario: Scenario): Row[] {
  const rows: Row[] = [];
  let prevRevenue: number | undefined;
  let prevUnits: number | undefined;
  let gapNominal = 0;
  let gapReal = 0;
  for (let turn = 0; turn < 16; turn++) {
    const { units, price } = scenario.steps(turn);
    const revenue = units * price;
    const nominal =
      turn === 0 ? null : computeRealizedRevenueGrowthRate(revenue, prevRevenue, 1, TURNS_PER_YEAR);
    const real =
      turn === 0 ? null : computeConstantPriceOutputGrowthRate(units, prevUnits, 1, TURNS_PER_YEAR);
    gapNominal = advanceOutputGap(
      gapNominal,
      nominal ?? era.potential,
      era.potential,
      TURNS_PER_YEAR
    ).gap;
    gapReal = advanceOutputGap(gapReal, real ?? era.potential, era.potential, TURNS_PER_YEAR).gap;
    rows.push({
      era: era.id,
      scenario: scenario.id,
      turn,
      revenue,
      units,
      nominal,
      real,
      divergence: realOutputShadowDivergence(nominal, real),
      gapNominal,
      gapReal,
    });
    prevRevenue = revenue;
    prevUnits = units;
  }
  return rows;
}

function fmt(value: number | null): string {
  return value === null ? "   null" : value.toFixed(2).padStart(7);
}

let failed = false;
for (const era of ERAS) {
  for (const scenario of SCENARIOS) {
    const rows = runScenario(era, scenario);
    console.log(`\n== ${era.id} / ${scenario.id} (potential ${era.potential}%) ==`);
    console.log("turn | revenue | units | nominal |    real |   divrg | gapNom | gapReal");
    for (const row of rows) {
      console.log(
        `${String(row.turn).padStart(4)} | ${row.revenue.toFixed(1).padStart(7)} | ` +
          `${String(row.units).padStart(5)} | ${fmt(row.nominal)} | ${fmt(row.real)} | ` +
          `${fmt(row.divergence)} | ${row.gapNominal.toFixed(2).padStart(6)} | ` +
          `${row.gapReal.toFixed(2).padStart(6)}`
      );
      console.log(JSON.stringify({ queue: "worldsim-print", ...row }));
    }
    // Contract assertions: price-only and FX-only shocks must leave the real
    // print at exactly 0 while the nominal print moves; physical shocks must
    // move both (both saturate the floor on a one-turn -20% contraction).
    const shockRows = rows.slice(8, 10);
    if (scenario.id === "price-only-crash" || scenario.id === "fx-only-restatement") {
      for (const row of shockRows) {
        if (row.real !== 0) {
          console.error(
            `FAIL: ${era.id}/${scenario.id} turn ${row.turn}: real=${row.real}, want 0`
          );
          failed = true;
        }
      }
      // The shock turn itself must move the nominal print; later turns settle
      // back to 0 as the new level becomes the baseline (expected).
      const first = rows[8]!;
      if (first.nominal === 0 || first.nominal === null) {
        console.error(`FAIL: ${era.id}/${scenario.id} turn 8: nominal did not move`);
        failed = true;
      }
    }
    if (scenario.id === "physical-contraction") {
      const first = rows[8]!;
      if (first.real !== SECTOR_SIGNAL_MIN || first.nominal !== SECTOR_SIGNAL_MIN) {
        console.error(
          `FAIL: ${era.id}/physical-contraction turn 8: real=${first.real} nominal=${first.nominal}, want both ${SECTOR_SIGNAL_MIN}`
        );
        failed = true;
      }
    }
  }
}

if (failed) {
  console.error("\nrealOutputShadowCompare: CONTRACT VIOLATED");
  process.exit(1);
}
console.log("\nrealOutputShadowCompare: nominal/real contract holds across both eras.");
