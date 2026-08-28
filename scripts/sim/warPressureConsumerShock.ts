/**
 * Deterministic balance probe for issue #1006. Run with:
 *
 *   npx tsx scripts/sim/warPressureConsumerShock.ts
 */
import { WAR_EMERGENCY_CRISIS_TEMPLATES } from "../../src/lib/crises/warEmergencyCrises";
import { getEventHandler } from "../../src/lib/events/substrate/registry";
import "../../src/lib/events/worldEvents/handlers/highTensionEvents";
import { VIETNAM_DEF } from "../../src/lib/livingConflict/defs/vietnam";
import {
  applyCommitment,
  emptyConflictState,
  openConflict,
} from "../../src/lib/livingConflict/engine";
import {
  vietnamWorldPressure,
  type ActiveWarSnapshot,
} from "../../src/lib/livingConflict/worldPressure";

const germanyWar: ActiveWarSnapshot = {
  status: "active",
  intensity: 70,
  hostCountry: "DD",
  hostEntities: ["DD", "DE"],
  sideA: { countries: ["US"] },
  sideB: { countries: ["DD", "RU"] },
};

function simulateVietnam(
  turns: number,
  year: number,
  tension: number,
  wars: ActiveWarSnapshot[],
  initial?: { phaseLevel: number; pressure: number }
) {
  let state = {
    ...openConflict(emptyConflictState("vietnam"), 1955),
    ...(initial ? { phaseLevel: initial.phaseLevel, pressure: { a: initial.pressure, b: 0 } } : {}),
  };
  const pressurePerTurn = vietnamWorldPressure(tension, wars);
  for (let turn = 0; turn < turns; turn += 1) {
    state = applyCommitment(VIETNAM_DEF, state, "a", pressurePerTurn, year);
  }
  return {
    turns,
    year,
    tension,
    pressurePerTurn,
    phaseLevel: state.phaseLevel,
    pressure: state.pressure.a ?? 0,
  };
}

const civilDefense = WAR_EMERGENCY_CRISIS_TEMPLATES.war_civil_defense_fever;
const retailShock = civilDefense.effects.find(
  (effect) => effect.targetType === "profitMargin" && effect.sectorType === "retail"
)!;
const handler = getEventHandler("worldEvents.civilDefenseFever")!;
const funded = handler.options.find((option) => option.id === "fund")!.outcomeTable[0];
const fundedShifts = funded.effects
  .filter((effect) => effect.type === "sectorOutputDemandModifier")
  .map((effect) => ({
    sectorType: effect.sectorType,
    pct: effect.pct,
    durationTurns: effect.durationTurns,
    exposureTurnPct: effect.pct * effect.durationTurns,
  }));

console.log(
  JSON.stringify(
    {
      vietnam: {
        quietAfterSixTurns: simulateVietnam(6, 1961, 100, []),
        germanyAfterSixTurns: simulateVietnam(6, 1961, 100, [germanyWar]),
        liveThresholdNextTurn: simulateVietnam(1, 1961, 100, [germanyWar], {
          phaseLevel: 1,
          pressure: 24,
        }),
        germanyAfterTwentyTurnsBeforeTonkin: simulateVietnam(20, 1961, 100, [germanyWar]),
        thresholdAtTonkinYear: simulateVietnam(1, 1964, 100, [germanyWar], {
          phaseLevel: 2,
          pressure: 24,
        }),
      },
      civilDefense: {
        durationTurns: civilDefense.durationTurns,
        retailMarginShockPoints: retailShock.value,
        exampleStartingMargin: 90,
        exampleOnsetEffectiveMargin: 90 + retailShock.value,
        fundedOutputDemandShifts: fundedShifts,
      },
    },
    null,
    2
  )
);
