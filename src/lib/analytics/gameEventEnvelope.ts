import type { GameIteration } from "@/lib/db/types/gameState";

/** Stable iteration key shared by browser and server game events. */
export function gameIterationId(iteration?: GameIteration | null): string {
  if (!iteration || !Number.isInteger(iteration.number) || iteration.number < 1) return "unknown";
  const type = iteration.type.toLowerCase();
  if (type !== "alpha" && type !== "beta" && type !== "iteration") return "unknown";
  return `${type}-${iteration.number}`;
}

export interface GameEventEnvelope {
  iteration_id: string;
  turn_number: number;
}

export function gameEventEnvelope(
  iteration: GameIteration | null | undefined,
  turn: number | null | undefined
): GameEventEnvelope {
  return {
    iteration_id: gameIterationId(iteration),
    turn_number: Number.isInteger(turn) && (turn as number) >= 0 ? (turn as number) : 0,
  };
}
