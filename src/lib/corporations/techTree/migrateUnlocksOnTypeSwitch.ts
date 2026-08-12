/**
 * Primary-type switch tech migration (ticket #1040).
 *
 * Sector-lane node ids are prefixed by primary type. Product rule: switching
 * primary type does NOT carry sector research into the new tree — those unlocks
 * are dropped (no R&D/cash refund), researchable-decade lane commitments clear,
 * and strength grants from the dropped researchable nodes reverse. Corporate-lane
 * (`corp-*`) unlocks stay. Past decades are replaced with the new type's
 * auto-grant baseline.
 */
import type { CorporationType } from "@/lib/constants/corporations";
import {
  autoGrantedNodeIds,
  getNodeById,
  getResearchableDecades,
  getTreeForType,
  sumStrengthGrants,
} from "@/lib/constants/techTree";

export interface PrimaryTypeSwitchTechMigration {
  unlockedTechNodeIds: string[];
  /** Researchable decade ids whose lane commitment should be cleared. */
  clearDecadeLaneIds: string[];
  /** Strength to subtract for dropped researchable-decade sector unlocks. */
  strengthGrantReversal: { marketingStrength: number; logisticsStrength: number };
}

/**
 * Compute the post-switch tech state. Idempotent when `fromType === toType`.
 */
export function migrateUnlockedTechOnPrimaryTypeSwitch(
  unlockedTechNodeIds: string[] | undefined,
  fromType: CorporationType,
  toType: CorporationType,
  currentYear: number,
  techDecadeLane?: Record<string, string> | null
): PrimaryTypeSwitchTechMigration {
  if (fromType === toType) {
    return {
      unlockedTechNodeIds: [...(unlockedTechNodeIds ?? [])],
      clearDecadeLaneIds: [],
      strengthGrantReversal: { marketingStrength: 0, logisticsStrength: 0 },
    };
  }

  const prior = unlockedTechNodeIds ?? [];
  const researchable = new Set(getResearchableDecades(currentYear).map((d) => d.id));
  const kept = new Set<string>();

  for (const id of prior) {
    if (id.startsWith("corp-")) kept.add(id);
  }

  for (const id of autoGrantedNodeIds(toType, currentYear)) {
    kept.add(id);
  }

  // Dropped researchable sector unlocks (any prefix) — these must not survive.
  const droppedResearchableIds = prior.filter((id) => {
    if (id.startsWith("corp-")) return false;
    if (kept.has(id)) return false; // past-decade auto-grant for new type
    // Parse trailing `-{decade}-{slot}` from sector ids.
    const m = id.match(/-(\d+)-(\d+)$/);
    if (!m) return true;
    return researchable.has(m[1]);
  });

  // Reverse strength grants only for nodes that existed on the OLD tree
  // (player-paid research). Unknown/orphan ids contribute nothing.
  const droppedNodes = droppedResearchableIds
    .map((id) => getNodeById(fromType, id))
    .filter((n): n is NonNullable<typeof n> => !!n);
  const grants = sumStrengthGrants(droppedNodes.flatMap((n) => n.effects));

  const clearDecadeLaneIds = [
    ...new Set([
      ...Object.keys(techDecadeLane ?? {}).filter((decadeId) => researchable.has(decadeId)),
      ...droppedResearchableIds
        .map((id) => id.match(/-(\d+)-\d+$/)?.[1])
        .filter((d): d is string => !!d && researchable.has(d)),
    ]),
  ];

  // Sanity: never keep a sector id from the old primary type.
  const fromTreeIds = new Set(getTreeForType(fromType).map((n) => n.id));
  for (const id of [...kept]) {
    if (!id.startsWith("corp-") && fromTreeIds.has(id) && id.startsWith(`${fromType}-`)) {
      kept.delete(id);
    }
  }

  return {
    unlockedTechNodeIds: [...kept],
    clearDecadeLaneIds,
    strengthGrantReversal: {
      marketingStrength: grants.marketingStrength,
      logisticsStrength: grants.logisticsStrength,
    },
  };
}
