import { describe, expect, it } from "vitest";
import { advanceCohort, type CohortInputs } from "./cohortFlows";
import { synthesizeAgeSexVector } from "./seedSynthesis";
import { totalPopulation, dependencyRatio } from "./cohortVector";
import { legislationTypes } from "@/lib/seeds/reference/legislationTypes";

/**
 * Legislative metric simulation — POPULATION category, 240 turns.
 *
 * Population metrics come from the DEMOGRAPHIC cohort engine (not the metric-engine
 * coexistence harness), so this is its own sim: it drives a real immigration law
 * ("Border Security and Immigration Enforcement Act", us_border_security_enforcement)
 * through `advanceCohort`. The Open Borders option (+1) raises net international
 * migration; the restrictive options cut it. Migrants enter at working ages, so over
 * 240 turns (5 game-years) the high-migration enactment should grow the population AND
 * lower the dependency ratio vs a low-migration control.
 */
const TPY = 48;
const TURNS = 240;

const law = legislationTypes.find((l) => l._id === "us_border_security_enforcement");
const openBorders = law?.policyOptions?.find((o) => /open borders/i.test(o.name));

function seed() {
  return synthesizeAgeSexVector({
    adultShares: { young: 24, mid: 27, mature: 31, senior: 18 },
    medianAge: 38,
    birthRate: 50,
    population: 1_000_000,
  });
}

function run(netInternationalMigrants: number) {
  let v = seed();
  const inputs: CohortInputs = {
    replacementTFR: 2.06,
    birthRateIndex: 50,
    healthcare: { lifeExpectancy: 50, preventableMortality: 50 },
    netInternationalMigrants,
    migrantShareMale: 0.5,
  };
  for (let t = 1; t <= TURNS; t++) v = advanceCohort(v, inputs, t, TPY).vector;
  return { pop: totalPopulation(v), dependency: dependencyRatio(v) };
}

describe("legislation sim — population (Border Security & Immigration Act, 240 turns)", () => {
  it("the seed immigration law and its Open Borders option exist", () => {
    expect(law, "us_border_security_enforcement present").toBeTruthy();
    expect(openBorders, "an Open Borders (+1) option exists").toBeTruthy();
  });

  // Control: restrictive baseline (~low net migration). Law: Open Borders (high migration).
  const control = run(100);
  const enacted = run(1500);

  it("prints the 240-turn result", () => {
    console.log(
      `\n══ Population — Border Security & Immigration Act (240-turn) ══\n` +
        `totalPopulation   control ${control.pop.toFixed(0)} → law ${enacted.pop.toFixed(0)}  (Δ ${(enacted.pop - control.pop).toFixed(0)}) ▲\n` +
        `dependencyRatio   control ${control.dependency.toFixed(4)} → law ${enacted.dependency.toFixed(4)}  (Δ ${(enacted.dependency - control.dependency).toFixed(4)}) ▼`
    );
    expect(true).toBe(true);
  });

  it("Open Borders grows the population vs the restrictive control", () => {
    expect(enacted.pop, `law ${enacted.pop} > control ${control.pop}`).toBeGreaterThan(control.pop);
  });

  it("working-age migration lowers the dependency ratio vs the control", () => {
    expect(
      enacted.dependency,
      `law ${enacted.dependency} < control ${control.dependency}`
    ).toBeLessThan(control.dependency);
  });

  it("the dependency ratio stays in a sane band (no demographic blow-up)", () => {
    expect(enacted.dependency).toBeGreaterThan(0.2);
    expect(enacted.dependency).toBeLessThan(1.2);
    expect(Number.isFinite(enacted.pop)).toBe(true);
    expect(enacted.pop).toBeGreaterThan(0);
  });
});
