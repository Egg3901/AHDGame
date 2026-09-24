/**
 * Deterministic before/after scenarios for Mechanics Help #1353.
 *
 * This is intentionally a state-transition simulation rather than a combat-odds
 * simulation: the change does not alter battle outcomes or occupation steps. It asks
 * only when the same sequence of control readings is allowed to finalize a war.
 *
 * Run:
 *   npx tsx scripts/sim/warMinimumDuration2026-09-24.ts
 */
import {
  eligiblePoleVictor,
  MIN_NON_PROXY_WAR_TURNS,
  sideAtPole,
} from "../../src/lib/military/rules/warResolution";

interface Movement {
  turn: number;
  control: number;
}

interface Scenario {
  name: string;
  openingControl: number;
  movements: Movement[];
  horizon: number;
}

interface Outcome {
  turn: number | null;
  victor: "A" | "B" | null;
}

function legacyOutcome(scenario: Scenario): Outcome {
  let control = scenario.openingControl;
  for (const movement of scenario.movements) {
    if (movement.control === control) continue;
    control = movement.control;
    const victor = sideAtPole(control);
    if (victor) return { turn: movement.turn, victor };
  }
  return { turn: null, victor: null };
}

function minimumDurationOutcome(scenario: Scenario): Outcome {
  let control = scenario.openingControl;
  let poleSide: "A" | "B" | null = null;
  let poleSinceTurn: number | null = null;
  const byTurn = new Map(scenario.movements.map((movement) => [movement.turn, movement.control]));

  for (let turn = 0; turn <= scenario.horizon; turn++) {
    const next = byTurn.get(turn);
    if (next != null && next !== control) {
      control = next;
      const arrived = sideAtPole(control);
      poleSide = arrived;
      poleSinceTurn = arrived ? turn : null;
    }

    const victor = eligiblePoleVictor({
      type: "interstate",
      status: "active",
      startTurn: 0,
      currentTurn: turn,
      control,
      poleSide,
      poleSinceTurn,
    });
    if (victor) return { turn, victor };
  }
  return { turn: null, victor: null };
}

const scenarios: Scenario[] = [
  {
    name: "Untouched defender opening",
    openingControl: 100,
    movements: [],
    horizon: 48,
  },
  {
    name: "Shallow incursion, immediate counterattack",
    openingControl: 100,
    movements: [
      { turn: 1, control: 99 },
      { turn: 2, control: 100 },
    ],
    horizon: 48,
  },
  {
    name: "Early attacker sweep",
    openingControl: 100,
    movements: [
      { turn: 1, control: 75 },
      { turn: 2, control: 50 },
      { turn: 3, control: 25 },
      { turn: 4, control: 0 },
    ],
    horizon: 48,
  },
  {
    name: "Early pole broken before minimum",
    openingControl: 100,
    movements: [
      { turn: 1, control: 99 },
      { turn: 2, control: 100 },
      { turn: 10, control: 99 },
    ],
    horizon: 48,
  },
  {
    name: "Defender retakes pole after minimum",
    openingControl: 100,
    movements: [
      { turn: 20, control: 99 },
      { turn: 25, control: 100 },
    ],
    horizon: 48,
  },
  {
    name: "Split German front reaches pole late",
    openingControl: 50,
    movements: [{ turn: 30, control: 0 }],
    horizon: 48,
  },
];

const display = ({ turn, victor }: Outcome) => (turn == null ? "continues" : `${victor}@${turn}`);

console.log(`Minimum non-proxy war duration: ${MIN_NON_PROXY_WAR_TURNS} turns`);
console.log("Scenario | Before | After");
console.log("--- | --- | ---");
for (const scenario of scenarios) {
  console.log(
    `${scenario.name} | ${display(legacyOutcome(scenario))} | ${display(minimumDurationOutcome(scenario))}`
  );
}
