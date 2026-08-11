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
}

export interface TurnPhaseAdapter {
  key: string;
  execute(context: TurnExecutionContext, runtime: TurnPhaseRuntime): Promise<void>;
}
