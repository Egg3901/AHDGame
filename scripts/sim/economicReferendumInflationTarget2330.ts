/**
 * Deterministic controlled replay for issue #2330. Compares the legacy fixed
 * inflation band with the target-centered rule in identical synthetic races.
 * No database, player data, wall clock, or randomness is used.
 *
 * Run: npx tsx scripts/sim/economicReferendumInflationTarget2330.ts
 */

import assert from "node:assert/strict";
import { MONETARY_BASELINES } from "@/lib/constants/currencies";
import { getEraMonetaryBaseline } from "@/lib/constants/monetaryEra";
import {
  applyReferendumShift,
  computeEconomicReferendum,
  type MiseryInputs,
} from "@/lib/electionEngine/economicReferendum";
import type { CountryId } from "@/lib/constants/countries";

const STARTING_VOTES = { incumbent: 46_000, opposition: 42_000, minor: 12_000 };
const CASES: ReadonlyArray<{ preset: string; country: CountryId; year: number }> = [
  { preset: "1953-default", country: "JP", year: 1953 },
  { preset: "1979-default", country: "US", year: 1979 },
  { preset: "1991-default", country: "US", year: 1991 },
  { preset: "1999-default", country: "US", year: 1999 },
  { preset: "2007-default", country: "US", year: 2007 },
  { preset: "2019-default", country: "US", year: 2019 },
  { preset: "2023-default", country: "US", year: 2023 },
  { preset: "2027-default", country: "US", year: 2027 },
];

function incumbentShare(votes: Record<string, number>): number {
  const total = Object.values(votes).reduce((sum, value) => sum + value, 0);
  return (100 * votes.incumbent) / total;
}

function run(): void {
  const rows = CASES.flatMap(({ preset, country, year }) => {
    const target =
      getEraMonetaryBaseline(country, year)?.targetInflation ??
      MONETARY_BASELINES[country].targetInflation;
    const base: MiseryInputs = {
      unemploymentRate: 6,
      povertyRate: 20,
      inflationRate: target,
      realIncomeTrendPct: 0,
    };
    return [
      { preset, country, year, target, inflation: target, scenario: "on-target" },
      { preset, country, year, target, inflation: target + 2, scenario: "target-plus-2" },
    ].map((scenario) => {
      const control = computeEconomicReferendum({ ...base, inflationRate: scenario.inflation }, 1);
      const treatment = computeEconomicReferendum(
        {
          ...base,
          inflationRate: scenario.inflation,
          inflationTargetPct: target,
        },
        1
      );
      const controlVotes = applyReferendumShift(STARTING_VOTES, ["incumbent"], control.sharePts);
      const treatmentVotes = applyReferendumShift(
        STARTING_VOTES,
        ["incumbent"],
        treatment.sharePts
      );
      const row = {
        preset,
        country,
        year,
        targetInflationPct: target,
        scenario: scenario.scenario,
        inflationPct: scenario.inflation,
        controlPenaltyPts: control.sharePts,
        treatmentPenaltyPts: treatment.sharePts,
        controlIncumbentSharePct: incumbentShare(controlVotes),
        treatmentIncumbentSharePct: incumbentShare(treatmentVotes),
        incumbentShareDeltaPp: incumbentShare(treatmentVotes) - incumbentShare(controlVotes),
      };

      if (scenario.scenario === "on-target") {
        assert.equal(treatment.sharePts, 0, `${preset} ${country}: target CPI must be neutral`);
      } else {
        assert.equal(treatment.sharePts, -0.2, `${preset} ${country}: target +2 must be penalized`);
      }
      assert.equal(
        Object.values(treatmentVotes).reduce((sum, value) => sum + value, 0),
        100_000
      );
      return row;
    });
  });

  const report = {
    issue: 2330,
    method:
      "Same pure referendum rule and fixed synthetic 46/42/12 vote map; control omits the era target and treatment supplies the authored country/era target. No DB or player data.",
    band: "3 percentage points wide, centered on the target when available; legacy [1,4] fallback otherwise",
    rows,
  };
  console.log(JSON.stringify(report, null, 2));
}

run();
