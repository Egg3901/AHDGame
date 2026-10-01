import type { WorldEntityMapSnapshot } from "./worldEntityMap";

export function backgroundMacroFeatureIds(snapshot: WorldEntityMapSnapshot): Set<string> {
  return new Set(
    Object.entries(snapshot.byFeatureId)
      .filter(
        ([, item]) =>
          item.status === "sovereign" &&
          item.simulationTier === "background-macro" &&
          item.macroSummary
      )
      .map(([id]) => id)
  );
}
