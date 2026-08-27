import type { GameIteration } from "@/lib/db/types/gameState";
import { turnToLarpDate } from "@/lib/utils/formatters";

const TYPE_RANK: Record<GameIteration["type"], number> = {
  Alpha: 0,
  Beta: 1,
  Iteration: 2,
};

/**
 * Display-name overrides for specific iterations. The iteration system stores
 * iterations as `{type, number}` (e.g. `Iteration 4`), but the current run is
 * branded to players with a version number. Keyed by `type:number`.
 * Past iterations (Alpha 1, Beta 1/2) are intentionally left as-is.
 */
const ITERATION_DISPLAY_OVERRIDES: Record<string, string> = {
  "Iteration:4": "1.0",
};

export function iterationLabel(it: GameIteration): string {
  return ITERATION_DISPLAY_OVERRIDES[`${it.type}:${it.number}`] ?? `${it.type} ${it.number}`;
}

export function iterationKey(it: GameIteration): string {
  return `${it.type}:${it.number}`;
}

export function compareIterations(a: GameIteration, b: GameIteration): number {
  if (TYPE_RANK[a.type] !== TYPE_RANK[b.type]) {
    return TYPE_RANK[a.type] - TYPE_RANK[b.type];
  }
  return a.number - b.number;
}

/**
 * Ordered, deduped union of the registry and any extra iterations referenced by
 * entries but missing from the registry. Everything is sorted by priority
 * (Alpha < Beta < Iteration, then number asc) so unknown iterations slot into
 * their natural position.
 */
export function orderIterations(
  registry: GameIteration[],
  extra: GameIteration[]
): GameIteration[] {
  const seen = new Set<string>();
  const all: GameIteration[] = [];
  for (const it of [...registry, ...extra]) {
    const key = iterationKey(it);
    if (seen.has(key)) continue;
    seen.add(key);
    all.push(it);
  }
  return all.sort(compareIterations);
}

export function weekYearFromTurn(turn: number, startingYear: number): string {
  return turnToLarpDate(turn, startingYear);
}

export function weekYearFromFields(week: number, year: number): string {
  return `Week ${week}, ${year}`;
}
