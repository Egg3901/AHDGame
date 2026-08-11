import { DEFAULT_TRANSITION_PRESSURES, getTransitionRule } from "./rules";
import type {
  HistoricalWindow,
  TransitionEvaluation,
  TransitionEvaluationInput,
  TransitionPressures,
  UnLifecycleSnapshot,
  UnLifecycleState,
} from "./types";
import { getWorldEntityOrThrow } from "@/lib/world/worldEntityManifest";

/** Score that must be reached for sovereignty this year. */
const SOVEREIGNTY_THRESHOLD = 0.35;
/** Conflict at or above this hard-blocks independence regardless of calendar. */
const CONFLICT_PREVENTION_FLOOR = 0.85;
/** After the latest year, a deeply negative score prevents rather than delays. */
const LATE_PREVENTION_SCORE = -0.25;

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

function clampPressures(pressures: TransitionPressures): TransitionPressures {
  return {
    legitimacy: clamp01(pressures.legitimacy),
    unrest: clamp01(pressures.unrest),
    conflict: clamp01(pressures.conflict),
    parentCapacity: clamp01(pressures.parentCapacity),
    spherePressure: clamp01(pressures.spherePressure),
  };
}

function parentDependencyLabel(
  parentEntityId: string | undefined,
  coParentEntityIds: readonly string[] | undefined
): string {
  const parents = [parentEntityId, ...(coParentEntityIds ?? [])].filter((id): id is string =>
    Boolean(id)
  );
  if (parents.length === 0) return "its metropolitan parent";
  if (parents.length === 1) return parents[0]!;
  if (parents.length === 2) return `${parents[0]}/${parents[1]}`;
  return parents.join("/");
}

/**
 * Calendar prior in roughly [-1, 1].
 * Neutral/default pressures at expectedYear should clear the sovereignty threshold.
 */
export function historicalPrior(year: number, window: HistoricalWindow): number {
  const { earliestYear, expectedYear, latestYear } = window;
  if (year < earliestYear) {
    // Soft ramp in the two years before the window opens; hard block earlier.
    const yearsEarly = earliestYear - year;
    return yearsEarly >= 2 ? -1 : -0.75;
  }
  if (year === expectedYear) return 0.55;
  if (year < expectedYear) {
    const span = expectedYear - earliestYear;
    const t = span <= 0 ? 1 : (year - earliestYear) / span;
    return -0.35 + t * 0.9;
  }
  if (year <= latestYear) {
    const span = latestYear - expectedYear;
    const t = span <= 0 ? 1 : (year - expectedYear) / span;
    return 0.55 + t * 0.3;
  }
  // Past the window: strong default to resolve, unless pressures prevent.
  return 0.95;
}

/**
 * Signed pressure modifier. Positive accelerates; negative delays / blocks.
 */
export function pressureDelta(pressures: TransitionPressures): number {
  const p = clampPressures(pressures);
  const extremeUnrestDrag = p.unrest > 0.8 ? (p.unrest - 0.8) * 1.5 : 0;

  return (
    (p.legitimacy - 0.5) * 0.8 +
    (p.spherePressure - 0.5) * 0.55 +
    p.unrest * 0.25 -
    extremeUnrestDrag -
    p.conflict * 0.9 -
    (p.parentCapacity - 0.5) * 0.7
  );
}

function describePressures(pressures: TransitionPressures, delta: number): string[] {
  const lines: string[] = [];
  if (pressures.legitimacy >= 0.7) {
    lines.push(`High legitimacy (${pressures.legitimacy.toFixed(2)}) accelerates independence.`);
  } else if (pressures.legitimacy <= 0.35) {
    lines.push(`Low legitimacy (${pressures.legitimacy.toFixed(2)}) delays independence.`);
  }
  if (pressures.spherePressure >= 0.7) {
    lines.push(
      `Strong sphere pressure (${pressures.spherePressure.toFixed(2)}) favors early sovereignty.`
    );
  } else if (pressures.spherePressure <= 0.25) {
    lines.push(
      `Weak sphere pressure (${pressures.spherePressure.toFixed(2)}) reduces external backing.`
    );
  }
  if (pressures.parentCapacity >= 0.7) {
    lines.push(
      `High parent capacity (${pressures.parentCapacity.toFixed(2)}) sustains colonial control.`
    );
  } else if (pressures.parentCapacity <= 0.35) {
    lines.push(`Low parent capacity (${pressures.parentCapacity.toFixed(2)}) weakens retention.`);
  }
  if (pressures.conflict >= 0.5) {
    lines.push(
      `Conflict intensity (${pressures.conflict.toFixed(2)}) delays or blocks recognition.`
    );
  }
  if (pressures.unrest >= 0.55 && pressures.unrest <= 0.8) {
    lines.push(`Elevated unrest (${pressures.unrest.toFixed(2)}) increases independence pressure.`);
  } else if (pressures.unrest > 0.8) {
    lines.push(`Extreme unrest (${pressures.unrest.toFixed(2)}) undermines orderly transfer.`);
  }
  if (lines.length === 0) {
    lines.push(
      `Pressures near historical baseline (Δ ${delta >= 0 ? "+" : ""}${delta.toFixed(2)}).`
    );
  }
  return lines;
}

function evaluateUnLifecycle(
  year: number,
  outcome: TransitionEvaluation["outcome"],
  pressures: TransitionPressures,
  expectedAdmissionYear: number,
  current?: UnLifecycleState
): UnLifecycleSnapshot {
  if (outcome === "prevented") {
    return {
      state: "ineligible",
      rationale: ["Sovereignty prevented — UN membership remains ineligible."],
    };
  }
  if (outcome === "hold") {
    return {
      state:
        current === "admitted" || current === "applied" || current === "eligible"
          ? current
          : "ineligible",
      rationale: ["Still a dependency — UN application is ineligible until sovereignty."],
    };
  }

  // Sovereignty succeeded.
  if (pressures.conflict >= 0.7) {
    return {
      state: "eligible",
      rationale: [
        "Sovereign but conflict delays UN application.",
        `Historical admission default remains ${expectedAdmissionYear}.`,
      ],
    };
  }
  if (pressures.legitimacy < 0.35) {
    return {
      state: "applied",
      rationale: [
        "UN application filed; low legitimacy slows Security Council / GA momentum.",
        `Historical admission default is ${expectedAdmissionYear}.`,
      ],
    };
  }
  if (year < expectedAdmissionYear && pressures.spherePressure < 0.35) {
    return {
      state: "applied",
      rationale: [
        `Early sovereignty before ${expectedAdmissionYear}; UN admission pending without strong sphere backing.`,
      ],
    };
  }

  return {
    state: "admitted",
    rationale: [
      `UN admission follows sovereignty on the historical default path (${expectedAdmissionYear}).`,
      "Application and General Assembly admission succeed under current pressures.",
    ],
  };
}

/**
 * Deterministic sovereignty / UN evaluation.
 * Same year + pressures ⇒ same decision (no RNG).
 */
export function evaluateTransition(input: TransitionEvaluationInput): TransitionEvaluation {
  const rule = getTransitionRule(input.ruleId);
  const pressures = clampPressures(input.pressures);
  const prior = historicalPrior(input.year, rule.window);
  const delta = pressureDelta(pressures);
  const score = prior + delta;
  const rationale: string[] = [];

  const source = getWorldEntityOrThrow(rule.presetId, rule.sourceEntityId);
  const parentLabel = parentDependencyLabel(source.parentEntityId, source.coParentEntityIds);

  rationale.push(
    `Historical window ${rule.window.earliestYear}–${rule.window.latestYear} (expected ${rule.window.expectedYear}).`
  );
  rationale.push(
    `Calendar prior ${prior.toFixed(2)}; pressure Δ ${delta >= 0 ? "+" : ""}${delta.toFixed(2)}; score ${score.toFixed(2)} vs threshold ${SOVEREIGNTY_THRESHOLD}.`
  );
  rationale.push(...describePressures(pressures, delta));

  let outcome: TransitionEvaluation["outcome"] = "hold";
  let effectiveYear: number | undefined;

  if (pressures.conflict >= CONFLICT_PREVENTION_FLOOR) {
    outcome = "prevented";
    rationale.push(
      `Conflict ${pressures.conflict.toFixed(2)} ≥ ${CONFLICT_PREVENTION_FLOOR} prevents sovereignty.`
    );
  } else if (input.year > rule.window.latestYear && score < LATE_PREVENTION_SCORE) {
    outcome = "prevented";
    rationale.push(
      `Past latest year ${rule.window.latestYear} with score ${score.toFixed(2)} < ${LATE_PREVENTION_SCORE}; independence prevented.`
    );
  } else if (input.year < rule.window.earliestYear && score < SOVEREIGNTY_THRESHOLD) {
    outcome = "hold";
    rationale.push(
      `Before earliest year ${rule.window.earliestYear}; holding as a dependency of ${parentLabel}.`
    );
  } else if (score >= SOVEREIGNTY_THRESHOLD) {
    outcome = "sovereignty";
    effectiveYear = input.year;
    if (input.year < rule.window.expectedYear) {
      rationale.push(
        `Accelerated sovereignty in ${input.year} (historical default ${rule.window.expectedYear}).`
      );
    } else if (input.year > rule.window.expectedYear) {
      rationale.push(
        `Delayed sovereignty in ${input.year} (historical default ${rule.window.expectedYear}).`
      );
    } else {
      rationale.push(`Sovereignty on the historical default path in ${rule.window.expectedYear}.`);
    }
  } else {
    outcome = "hold";
    if (input.year >= rule.window.expectedYear) {
      rationale.push(
        `Holding past expected year — pressures keep score ${score.toFixed(2)} below threshold.`
      );
    } else {
      rationale.push(`Holding — score ${score.toFixed(2)} below sovereignty threshold.`);
    }
  }

  const un = evaluateUnLifecycle(
    input.year,
    outcome,
    pressures,
    rule.unAdmissionExpectedYear,
    input.unState
  );

  return {
    ruleId: rule.ruleId,
    sourceEntityId: rule.sourceEntityId,
    targetEntityId: rule.targetEntityId,
    year: input.year,
    turn: input.turn,
    outcome,
    score,
    threshold: SOVEREIGNTY_THRESHOLD,
    historicalPrior: prior,
    pressureDelta: delta,
    rationale,
    un,
    effectiveYear,
  };
}

/** Convenience: evaluate a rule with optional pressure overrides over the baseline. */
export function evaluateTransitionWithDefaults(
  ruleId: string,
  year: number,
  turn: number,
  pressures: Partial<TransitionPressures> = {}
): TransitionEvaluation {
  return evaluateTransition({
    ruleId,
    year,
    turn,
    pressures: { ...DEFAULT_TRANSITION_PRESSURES, ...pressures },
  });
}

/** Convenience: evaluate Gold Coast → Ghana with optional pressure overrides. */
export function evaluateGoldCoastTransition(
  year: number,
  turn: number,
  pressures: Partial<TransitionPressures> = {}
): TransitionEvaluation {
  return evaluateTransitionWithDefaults("gold-coast-to-ghana", year, turn, pressures);
}
