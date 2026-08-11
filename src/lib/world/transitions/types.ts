import type { MacroCountryState } from "@/lib/world/macro/types";
import type { SphereMembership } from "@/lib/world/spheres/types";
import type {
  WorldEntityId,
  WorldEntityManifestEntry,
  WorldEntityLifecycle,
  WorldSimulationTier,
  WorldUnLifecycleState,
} from "@/lib/world/worldEntityManifest";

/** UN membership lifecycle for a polity after (or before) sovereignty. */
export type UnLifecycleState = WorldUnLifecycleState;

export type SovereigntyOutcome = "hold" | "sovereignty" | "prevented";

/** Authored historical window — strong default, not a rail. */
export interface HistoricalWindow {
  earliestYear: number;
  expectedYear: number;
  latestYear: number;
}

/**
 * Simulation pressures that shift timing or outcome away from the historical prior.
 * All scores are 0–1.
 */
export interface TransitionPressures {
  /** Local nationalist / self-government legitimacy. High accelerates. */
  legitimacy: number;
  /** Domestic unrest. Moderate accelerates; extreme can delay recognition. */
  unrest: number;
  /** Active conflict involving the dependency or parent. High delays / prevents. */
  conflict: number;
  /** Parent metropolitan capacity to retain the dependency. High delays. */
  parentCapacity: number;
  /** External sphere pressure toward independence. High accelerates. */
  spherePressure: number;
}

export interface TransitionRule {
  ruleId: string;
  presetId: string;
  sourceEntityId: WorldEntityId;
  targetEntityId: WorldEntityId;
  displayName: string;
  window: HistoricalWindow;
  /** Historical UN admission year after sovereignty (default path). */
  unAdmissionExpectedYear: number;
  /**
   * Tier granted on successful sovereignty.
   * Never `"full-autonomous"` — Tier-1 requires an explicit authored migration.
   */
  targetSimulationTier: Exclude<WorldSimulationTier, "full-autonomous">;
}

export interface TransitionEvaluationInput {
  ruleId: string;
  year: number;
  turn: number;
  pressures: TransitionPressures;
  /** Current UN state when re-evaluating after sovereignty. */
  unState?: UnLifecycleState;
}

export interface UnLifecycleSnapshot {
  state: UnLifecycleState;
  rationale: string[];
}

export interface TransitionEvaluation {
  ruleId: string;
  sourceEntityId: WorldEntityId;
  targetEntityId: WorldEntityId;
  year: number;
  turn: number;
  outcome: SovereigntyOutcome;
  /** Signed score: higher favors sovereignty now. */
  score: number;
  threshold: number;
  historicalPrior: number;
  pressureDelta: number;
  rationale: string[];
  un: UnLifecycleSnapshot;
  /** Independence year when outcome is sovereignty. */
  effectiveYear?: number;
}

export interface SovereigntyApplication {
  evaluation: TransitionEvaluation;
  dissolvedEntityId: WorldEntityId;
  sovereignEntity: WorldEntityManifestEntry;
  macroSeed: MacroCountryState | null;
  sphereMembership: SphereMembership | null;
  un: UnLifecycleSnapshot;
  rationale: string[];
}

export interface TransitionDiagnostics {
  ruleId: string;
  sourceEntityId: WorldEntityId;
  targetEntityId: WorldEntityId;
  sourceStatus: string;
  parentEntityId?: WorldEntityId;
  coParentEntityIds?: readonly WorldEntityId[];
  window: HistoricalWindow;
  lifecycle: WorldEntityLifecycle;
  lastEvaluation: TransitionEvaluation | null;
  un: UnLifecycleSnapshot;
  rationale: string[];
}
