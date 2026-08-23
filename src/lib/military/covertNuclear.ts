import type { CountryId } from "@/lib/constants/countries";

/**
 * The covert nuclear programme: East Germany building a bomb under the
 * Soviets' nose.
 *
 * Unlike the overt programme this is a grind, not a tree. Five stages, each a
 * long slog of quiet funding; nothing shows on any public surface until the
 * Soviets catch it or the DDR breaks out. The tension in the design is
 * pace against exposure: funding harder moves faster and burns brighter.
 * Discovery is a Soviet crackdown, not a game over - the programme loses
 * ground and the world learns a little, and the crawl can resume.
 *
 * Completing the final stage banks a device. The breakout test is a separate,
 * deliberate, public act: it opens a real nuclearPrograms entry with the
 * fission device adopted and the biggest tension spike in the system.
 */

export const COVERT_CAPABLE: readonly CountryId[] = ["DD"];

export type CovertFunding = "none" | "trickle" | "steady" | "crash";

export interface CovertStage {
  key: string;
  name: string;
  desc: string;
}

/** Progress each stage takes to complete. */
export const STAGE_PROGRESS = 60;

export const COVERT_STAGES: CovertStage[] = [
  {
    key: "uranium",
    name: "Uranium Diversion",
    desc: "Ore skimmed from the Wismut shipments before Moscow counts it.",
  },
  {
    key: "enrichment",
    name: "Covert Enrichment",
    desc: "Centrifuges in a mine that officially closed years ago.",
  },
  {
    key: "design",
    name: "Weapons Design Bureau",
    desc: "A physics institute with a second, unwritten charter.",
  },
  {
    key: "cold-tests",
    name: "Cold Implosion Tests",
    desc: "Everything but the core, proven without a flash anyone could see.",
  },
  {
    key: "assembly",
    name: "Device Assembly",
    desc: "A working bomb, waiting on a political decision.",
  },
];

/** Per-turn progress by funding level. */
export const FUNDING_PROGRESS: Record<CovertFunding, number> = {
  none: 0,
  trickle: 1,
  steady: 2,
  crash: 4,
};

/** Per-turn cost by funding level, drawn from the defence appropriation. */
export const FUNDING_COST: Record<CovertFunding, number> = {
  none: 0,
  trickle: 90,
  steady: 260,
  crash: 780,
};

/** Per-turn suspicion movement: funded levels add, an idle programme cools. */
export const FUNDING_SUSPICION: Record<CovertFunding, number> = {
  none: -0.3,
  trickle: 0.15,
  steady: 0.5,
  crash: 1.2,
};

export interface CovertProgramState {
  /** Completed stages, 0..COVERT_STAGES.length. */
  stage: number;
  /** Progress into the current stage, 0..STAGE_PROGRESS. */
  progress: number;
  funding: CovertFunding;
  /** 0-100. What Soviet counterintelligence has to work with. */
  suspicion: number;
  exposureCount: number;
  startedTurn?: number;
  /** Set when all stages are complete: a device exists, unannounced. */
  completed: boolean;
}

export function emptyCovertProgram(): CovertProgramState {
  return {
    stage: 0,
    progress: 0,
    funding: "none",
    suspicion: 0,
    exposureCount: 0,
    completed: false,
  };
}

export function clampSuspicion(v: number): number {
  return Math.max(0, Math.min(100, Math.round(v * 100) / 100));
}

/**
 * Per-turn discovery chance. Zero below a working floor of suspicion, then
 * quadratic: a hot crash programme (suspicion 60) risks about 1.8% a turn,
 * a patient trickle stays near noise.
 */
export function discoveryChance(suspicion: number): number {
  const s = Math.max(0, suspicion - 10);
  return Math.min(0.05, (s / 100) ** 2 * 0.072);
}

export interface CovertTurnResult {
  state: CovertProgramState;
  spent: number;
  /** The Soviets found it this turn. */
  discovered: boolean;
  /** A stage was completed this turn (index into COVERT_STAGES). */
  stageCompleted?: number;
  /** All stages done this turn: the device is banked. */
  justCompleted: boolean;
}

/**
 * One turn of the covert grind. `roll` is the discovery roll in [0,1),
 * injected so the maths stays testable. `budgetAvailable` caps spending:
 * a turn the treasury cannot fund makes no progress and cools instead.
 */
export function stepCovertProgram(
  state: CovertProgramState,
  budgetAvailable: number,
  roll: number
): CovertTurnResult {
  if (state.completed || state.funding === "none") {
    const cooled = {
      ...state,
      suspicion: clampSuspicion(state.suspicion + FUNDING_SUSPICION.none),
    };
    return { state: cooled, spent: 0, discovered: false, justCompleted: false };
  }

  const cost = FUNDING_COST[state.funding];
  if (budgetAvailable < cost) {
    const cooled = {
      ...state,
      suspicion: clampSuspicion(state.suspicion + FUNDING_SUSPICION.none),
    };
    return { state: cooled, spent: 0, discovered: false, justCompleted: false };
  }

  const suspicion = clampSuspicion(state.suspicion + FUNDING_SUSPICION[state.funding]);

  // Discovery check runs on the pre-progress reading: the crackdown lands on
  // what the programme was, not on what this turn would have added.
  if (roll < discoveryChance(suspicion)) {
    const crackdown: CovertProgramState = {
      ...state,
      // Lose the stage in progress and one completed stage.
      stage: Math.max(0, state.stage - 1),
      progress: 0,
      funding: "none",
      suspicion: 30,
      exposureCount: state.exposureCount + 1,
    };
    return { state: crackdown, spent: cost, discovered: true, justCompleted: false };
  }

  let stage = state.stage;
  let progress = state.progress + FUNDING_PROGRESS[state.funding];
  let stageCompleted: number | undefined;
  let completed = false;
  if (progress >= STAGE_PROGRESS) {
    stageCompleted = stage;
    stage += 1;
    progress = 0;
    if (stage >= COVERT_STAGES.length) completed = true;
  }

  return {
    state: {
      ...state,
      stage,
      progress,
      suspicion,
      completed,
      funding: completed ? "none" : state.funding,
    },
    spent: cost,
    discovered: false,
    stageCompleted,
    justCompleted: completed,
  };
}

/** Tension spike when a crackdown makes the papers. */
export const CRACKDOWN_TENSION_SPIKE = 6;
/** Tension spike when the DDR announces itself with a breakout test. */
export const BREAKOUT_TENSION_SPIKE = 15;
/** order.deterrence shock for the DDR on breakout. */
export const BREAKOUT_DETERRENCE_SHOCK = 10;
