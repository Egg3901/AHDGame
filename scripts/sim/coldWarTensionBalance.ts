/**
 * Deterministic balance probe for the Cold War tension floor and the four
 * tension-gated society events. Run with:
 *
 *   npx tsx scripts/sim/coldWarTensionBalance.ts
 */
import {
  stepTension,
  tensionBand,
  tensionFloor,
  type TensionPressures,
} from "../../src/lib/coldwar/tension";
import { WORLD_EVENT_SEED_DEFINITIONS } from "../../src/lib/events/worldEvents/definitions";
import { getEventHandler } from "../../src/lib/events/substrate/registry";
import "../../src/lib/events/worldEvents/handlers/highTensionEvents";

const eventKinds = [
  "worldEvents.panicBuying",
  "worldEvents.bankRun",
  "worldEvents.civilDefenseFever",
  "worldEvents.warScareProtests",
] as const;

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

console.log("SOCIETY EVENT EXPOSURE PER COUNTRY");
for (const kind of eventKinds) {
  const definition = WORLD_EVENT_SEED_DEFINITIONS.find((candidate) => candidate.kind === kind)!;
  const schedule = definition.schedule?.kind === "window" ? definition.schedule : null;
  const meanGap = schedule ? (schedule.minGapTurns + schedule.maxGapTurns) / 2 : Infinity;
  const handler = getEventHandler(kind)!;
  const fallback = handler.options.find((option) => option.id === handler.defaultOptionId)!;
  let expectedApproval = 0;
  let expectedTreasuryAnchor = 0;
  let expectedDemandTurnPct = 0;
  for (const tier of fallback.outcomeTable) {
    const probability = (tier.maxRoll - tier.minRoll + 1) / 100;
    for (const effect of tier.effects) {
      if (effect.type === "approvalDelta") expectedApproval += effect.delta * probability;
      if (effect.type === "treasuryDelta") {
        expectedTreasuryAnchor += effect.deltaAnchor * probability;
      }
      if (effect.type === "sectorDemandModifier") {
        expectedDemandTurnPct += effect.pct * effect.durationTurns * probability;
      }
    }
  }
  console.log(
    JSON.stringify({
      kind,
      minTension: definition.minTension,
      meanGapTurns: meanGap,
      expectedFiresPer100HighTensionTurns: Number((100 / meanGap).toFixed(2)),
      fallback: handler.defaultOptionId,
      expectedApproval: Number(expectedApproval.toFixed(2)),
      expectedTreasuryAnchor: Number(expectedTreasuryAnchor.toFixed(2)),
      expectedDemandTurnPct: Number(expectedDemandTurnPct.toFixed(2)),
    })
  );
}
