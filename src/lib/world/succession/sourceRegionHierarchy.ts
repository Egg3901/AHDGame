import type { State } from "@/lib/db/types/state";

/** Resolve nested district locations to the top-level federation regions that
 * a ratified territorial partition assigns to sovereign successors. */
export function buildSourceRegionHierarchy(states: readonly State[]): {
  topLevel: State[];
  topLevelFor: (stateId: string | null | undefined) => string | null;
} {
  const topLevel = states.filter((state) => !state.parentRegionId);
  if (
    topLevel.length === 0 ||
    topLevel.some(
      (state) =>
        !state._id.trim() ||
        !Number.isSafeInteger(state.population) ||
        state.population < 0 ||
        !Number.isFinite(state.gdp) ||
        state.gdp < 0
    )
  )
    throw new Error("Live federation regions are missing or invalid");
  const stateById = new Map(states.map((state) => [state._id, state]));
  if (stateById.size !== states.length)
    throw new Error("Live federation contains duplicate region identities");
  const topLevelFor = (stateId: string | null | undefined): string | null => {
    if (!stateId) return null;
    const visited = new Set<string>();
    let current: string | undefined = stateId;
    while (current) {
      const state = stateById.get(current);
      if (!state) return null;
      if (visited.has(current))
        throw new Error("Live federation region hierarchy contains a cycle");
      visited.add(current);
      if (!state.parentRegionId) return state._id;
      current = state.parentRegionId;
    }
    return null;
  };
  for (const state of states) {
    if (topLevelFor(state._id) === null)
      throw new Error("Live federation region hierarchy has a missing parent");
  }
  return { topLevel, topLevelFor };
}
