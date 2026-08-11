/**
 * Production-method (sector strategy) gating by the tech tree.
 *
 * A strategy can require an era (`minDecade`) and/or a tech unlock
 * (`requiresTechUnlock`, satisfied by an `unlockStrategy` node). This is inert
 * when the tech-trees feature is off, so existing worlds keep every method.
 *
 * For the tech-unlock check we merge the corp's actual researched nodes with the
 * auto-granted past-decade sector nodes. This ensures corps that predate the tech
 * tree (empty unlockedTechNodeIds) and newly founded late-era corps both have
 * access to strategies whose unlock nodes live in past decades.
 */
import type { SectorStrategy } from "../sectorStrategies";
import { isDecadeReached } from "./decades";
import { autoGrantedNodeIds, getUnlockedStrategyIds, type TechCorpView } from "./selectors";

export interface StrategyAvailability {
  locked: boolean;
  /** Why it's locked: the world hasn't reached the era, or the corp hasn't unlocked it. */
  reason?: "era" | "tech";
}

/**
 * Whether `strategy` is available to `corp` at `currentYear`. When
 * `techTreesEnabled` is false, everything is available (no gating).
 */
export function getStrategyAvailability(
  corp: TechCorpView,
  strategy: Pick<SectorStrategy, "id" | "minDecade" | "requiresTechUnlock">,
  currentYear: number,
  techTreesEnabled: boolean
): StrategyAvailability {
  if (!techTreesEnabled) return { locked: false };
  if (strategy.minDecade && !isDecadeReached(strategy.minDecade, currentYear)) {
    return { locked: true, reason: "era" };
  }
  if (strategy.requiresTechUnlock) {
    // Merge DB-stored nodes with auto-granted past-decade nodes so that:
    // (a) corps founded before tech trees (empty unlockedTechNodeIds) and
    // (b) late-era corps who never saw past decades in their research UI
    // both inherit the sector unlocks those decades carry.
    const autoGranted = autoGrantedNodeIds(corp.type, currentYear);
    const effectiveView: TechCorpView = {
      ...corp,
      unlockedTechNodeIds: [...(corp.unlockedTechNodeIds ?? []), ...autoGranted],
    };
    if (!getUnlockedStrategyIds(effectiveView).includes(strategy.id)) {
      return { locked: true, reason: "tech" };
    }
  }
  return { locked: false };
}
