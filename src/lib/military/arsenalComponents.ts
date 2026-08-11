import type { UnitDomain } from "@/lib/db/types/militaryUnit";
import { getNodeById, isDecadeReached, CORP_LANE_EFFECT_SCALE } from "@/lib/constants/techTree";

/**
 * Which arsenal component a defence plant supplies, derived from the production strategy the
 * CEO ALREADY chooses per sector.
 *
 * Deliberately NOT a separate `certifiedComponent` field. Strategy is the certification: a
 * parallel lever also meaning "what this plant makes" is the overlapping-knob pattern that was
 * rejected when the original tech-tree proposal's "corps pick a focus" turned out to already
 * exist as `techDecadeLane`. Extending the strategy list (naval/missile/aerospace) reaches the
 * remaining domains without inventing a second thing for a CEO to keep in sync.
 *
 * A strategy serving two domains splits its output evenly between them.
 */
export const DEFENCE_STRATEGY_COMPONENT: Record<string, UnitDomain[]> = {
  heavy_armor: ["ground"],
  munitions: ["ground"],
  directed_energy: ["air"],
  /**
   * Intentionally empty. `cyber` supplies electronics and software — capability, not materiel.
   * Giving it an arsenal bucket would create a store no unit could ever draw from, which is
   * the dead end that sank the original proposal's "Surveillance & Intelligence" component.
   * A cyber plant earns from the commodity market exactly as it does today; it is simply not
   * an arms supplier.
   */
  cyber: [],
  standard: ["ground", "air"],
  naval_systems: ["naval", "marine"],
  missile_systems: ["rocket"],
  aerospace: ["air", "space"],
};

/**
 * The arsenal components a sector supplies, or `[]` for a sector that supplies none.
 *
 * Every caller must handle the empty case: it is reached by `cyber`, by a defence sector whose
 * strategy has not been set, and by any non-defence sector.
 */
export function componentsForStrategy(strategyId: string | undefined | null): UnitDomain[] {
  if (!strategyId) return [];
  return DEFENCE_STRATEGY_COMPONENT[strategyId] ?? [];
}

/** Highest grade any corporation can deliver, matching the unit `techTier` ceiling. */
export const MAX_DELIVERABLE_GRADE = 3;

/**
 * How good the materiel a corporation can build is — the ceiling on the grade of every lot it
 * delivers, on the same 0..3 scale as `MilitaryUnit.techTier`.
 *
 * Counts the DECADE TIERS of the defence tree the corp holds unlocked nodes in, ignoring
 * decades the world clock has not reached, then scales by the lane the corp committed to.
 * Reusing `CORP_LANE_EFFECT_SCALE` means a Specialist reaches the ceiling and a Corporate-lane
 * generalist tops out lower — the distinction the lane already encodes, rather than a second
 * one invented here. No new unlock currency either: `rdScore` and the node cash cost already
 * gate the tree.
 *
 * A node is counted at the lane recorded for ITS decade, so a corp that specialised in one
 * decade and generalised in another is scored per decade rather than by a single global lane.
 */
export function gradeCeilingFor(
  corp: {
    unlockedTechNodeIds?: string[];
    techDecadeLane?: Record<string, "generic" | "sector">;
  },
  currentYear: number
): number {
  const unlocked = corp.unlockedTechNodeIds ?? [];
  if (unlocked.length === 0) return 0;

  // Decade → the best lane weight any counted node in it carries.
  const weightByDecade = new Map<string, number>();
  for (const nodeId of unlocked) {
    // Resolved through the tree rather than parsed from the id string: the id format
    // (`<sectorType>-<decade>-<slot>`) is an implementation detail of node authoring, and a
    // node carries its own `decadeId` and `lane`.
    const node = getNodeById("defense", nodeId);
    if (!node) continue; // not part of the defence tree
    if (!isDecadeReached(node.decadeId, currentYear)) continue;

    const lane = corp.techDecadeLane?.[node.decadeId] ?? node.lane;
    const weight = lane === "sector" ? 1 : CORP_LANE_EFFECT_SCALE;
    weightByDecade.set(node.decadeId, Math.max(weightByDecade.get(node.decadeId) ?? 0, weight));
  }

  let score = 0;
  for (const weight of weightByDecade.values()) score += weight;
  return Math.min(MAX_DELIVERABLE_GRADE, Math.floor(score));
}
