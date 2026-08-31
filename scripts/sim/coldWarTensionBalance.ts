/**
 * Deterministic balance probe for the Cold War tension floor. Run with:
 *
 *   npx tsx scripts/sim/coldWarTensionBalance.ts
 */
import {
  stepTension,
  tensionBand,
  tensionFloor,
  type TensionPressures,
} from "../../src/lib/coldwar/tension";
const scenarios: Array<{ name: string; pressures: TensionPressures }> = [
  {
    name: "quiet",
    pressures: {
      escalationLevel: 0,
      activeCrises: 0,
      totalWarheads: 0,
      nuclearWarIntensity: 0,
      nuclearWarCount: 0,
      otherWarIntensity: 0,
    },
  },
  {
    name: "vietnam rung 1",
    pressures: {
      escalationLevel: 1,
      activeCrises: 0,
      totalWarheads: 0,
      nuclearWarIntensity: 0,
      nuclearWarCount: 0,
      otherWarIntensity: 0,
    },
  },
  {
    name: "conventional war intensity 70",
    pressures: {
      escalationLevel: 0,
      activeCrises: 0,
      totalWarheads: 0,
      nuclearWarIntensity: 0,
      nuclearWarCount: 0,
      otherWarIntensity: 70,
    },
  },
  {
    name: "small nuclear powers at war",
    pressures: {
      escalationLevel: 0,
      activeCrises: 0,
      totalWarheads: 2,
      nuclearWarIntensity: 1,
      nuclearWarCount: 1,
      otherWarIntensity: 0,
    },
  },
  {
    name: "live Germany conditions",
    pressures: {
      escalationLevel: 1,
      activeCrises: 6,
      totalWarheads: 1214,
      nuclearWarIntensity: 70,
      nuclearWarCount: 1,
      otherWarIntensity: 0,
    },
  },
  {
    name: "Germany after maximum limited-war acclimation",
    pressures: {
      escalationLevel: 1,
      activeCrises: 6,
      totalWarheads: 1214,
      nuclearWarIntensity: 42,
      nuclearWarCount: 1,
      nuclearWarMinimumPressure: 30,
      otherWarIntensity: 0,
    },
  },
];

console.log("TENSION SCENARIOS");
for (const scenario of scenarios) {
  const floor = tensionFloor(scenario.pressures);
  let reading = 20.5;
  for (let turn = 0; turn < 24; turn += 1) reading = stepTension(reading, scenario.pressures);
  console.log(
    JSON.stringify({
      scenario: scenario.name,
      floor,
      band: tensionBand(floor),
      firstTurn: stepTension(20.5, scenario.pressures),
      turn24: reading,
    })
  );
}
