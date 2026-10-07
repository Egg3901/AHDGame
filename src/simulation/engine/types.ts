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
}

export interface CompletedTurnPhaseObservation {
  name: string;
  result: unknown;
}

export interface TurnPhaseAdapter {
  key: string;
  execute(context: TurnExecutionContext, runtime: TurnPhaseRuntime): Promise<void>;
}
