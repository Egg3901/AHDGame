import type { Db } from "mongodb";
import type {
  Character,
  GameConfig,
  GameIteration,
  GameState,
  State,
  TurnLog,
  TurnPhaseSkipReason,
  TurnPhaseTelemetryMap,
} from "@/lib/db/types";

export interface TurnExecutionContext {
  db: Db;
  gameState: GameState;
  config: GameConfig | null;
  activeIteration?: GameIteration;
  newTurn: number;
  calendarTurn: number;
  currentYear: number;
  gameNow: Date;
  realNow: Date;
  startTimeMs: number;
  nextTurnTime: Date;
  characters: Character[];
  states: State[];
  stateMap: Map<string, State>;
  warnings: string[];
  phaseStatuses: TurnPhaseTelemetryMap;
  phaseResults: TurnLog["phases"];
}

export interface TurnPhaseRuntime {
  runPhase<T>(name: string, fn: () => Promise<T>): Promise<T | null>;
  markPhaseSkipped(phase: string, reason: TurnPhaseSkipReason, message: string): Promise<void>;
  /**
   * Resolves once every phase that timed out has actually stopped. A timeout
   * does not cancel the phase function, so the turn must await this before it
   * commits or releases its lock (#3385).
   */
  drainTimedOutPhases?(): Promise<void>;
  /**
   * The phase result a dependent phase needs, or an explicit failure. On a crash
   * resume, distinguishes an interrupted phase from a completed one whose stored
   * result is missing; neither reruns and neither becomes a zero flow (#3429).
   */
  requirePhaseResult<T>(phase: string, result: T | null, dependent: string): T;
  /** How a crash resume answered a result-carrying phase; null when it ran normally. */
  resumeResultOutcome(phase: string): "restored" | "missing" | "interrupted" | null;
}

export interface CompletedTurnPhaseObservation {
  name: string;
  result: unknown;
}

export interface TurnPhaseAdapter {
  key: string;
  execute(context: TurnExecutionContext, runtime: TurnPhaseRuntime): Promise<void>;
}
