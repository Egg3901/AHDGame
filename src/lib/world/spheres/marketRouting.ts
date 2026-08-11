import type { CommodityType } from "@/lib/constants/commodities";
import type { CorporationType } from "@/lib/constants/corporations";
import type { MacroMarketContribution } from "@/lib/world/macro/types";
import { clampShare } from "./bounds";
import { resolvePrimarySponsor } from "./relationships";
import type {
  SphereBounds,
  SphereMarketAllocation,
  SphereMembership,
  SphereRoutedContribution,
} from "./types";

function scaleContribution(
  contribution: MacroMarketContribution,
  share: number,
  turn: number
): MacroMarketContribution {
  const factor = clampShare(share);
  const byCommodity: MacroMarketContribution["byCommodity"] = {};
  for (const [commodity, bal] of Object.entries(contribution.byCommodity) as [
    CommodityType,
    { supply: number; demand: number },
  ][]) {
    const supply = Math.round(bal.supply * factor * 100) / 100;
    const demand = Math.round(bal.demand * factor * 100) / 100;
    if (supply > 0 || demand > 0) {
      byCommodity[commodity] = { supply, demand };
    }
  }

  const bySector: MacroMarketContribution["bySector"] = {};
  for (const [sector, bal] of Object.entries(contribution.bySector) as [
    CorporationType,
    { output: number; demand: number },
  ][]) {
    bySector[sector] = {
      output: Math.round(bal.output * factor * 100) / 100,
      demand: Math.round(bal.demand * factor * 100) / 100,
    };
  }

  return {
    byCommodity,
    bySector,
    computedOnTurn: turn,
  };
}

function mergeContributions(
  parts: readonly MacroMarketContribution[],
  turn: number
): MacroMarketContribution {
  const byCommodity: MacroMarketContribution["byCommodity"] = {};
  const bySector: MacroMarketContribution["bySector"] = {};

  for (const part of parts) {
    for (const [commodity, bal] of Object.entries(part.byCommodity) as [
      CommodityType,
      { supply: number; demand: number },
    ][]) {
      const target = byCommodity[commodity] ?? { supply: 0, demand: 0 };
      target.supply = Math.round((target.supply + bal.supply) * 100) / 100;
      target.demand = Math.round((target.demand + bal.demand) * 100) / 100;
      byCommodity[commodity] = target;
    }
    for (const [sector, bal] of Object.entries(part.bySector) as [
      CorporationType,
      { output: number; demand: number },
    ][]) {
      const target = bySector[sector] ?? { output: 0, demand: 0 };
      target.output = Math.round((target.output + bal.output) * 100) / 100;
      target.demand = Math.round((target.demand + bal.demand) * 100) / 100;
      bySector[sector] = target;
    }
  }

  return { byCommodity, bySector, computedOnTurn: turn };
}

/**
 * Route a held macro contribution through primary/secondary sphere rules.
 *
 * Only the primary receives share 1.0 (full package). Each secondary receives
 * at most `bounds.secondaryMarketShare`, and the sum of secondary shares is
 * capped by `bounds.maxTotalSecondaryMarketShare` — never a second full copy.
 */
export function routeMacroContributionThroughSpheres(
  contribution: MacroMarketContribution,
  membership: SphereMembership,
  bounds: SphereBounds,
  turn = contribution.computedOnTurn
): Omit<SphereRoutedContribution, "flows"> {
  const primaryId = resolvePrimarySponsor(membership);
  const allocations: SphereMarketAllocation[] = [];
  const marketParts: MacroMarketContribution[] = [];

  let secondaryBudget = clampShare(bounds.maxTotalSecondaryMarketShare);
  const secondaryCap = clampShare(bounds.secondaryMarketShare);

  for (const rel of membership.relationships) {
    const isPrimary = primaryId != null && rel.sponsorId === primaryId;
    let share = 0;
    if (isPrimary) {
      share = 1;
    } else if (secondaryCap > 0 && secondaryBudget > 0) {
      share = Math.min(secondaryCap, secondaryBudget);
      secondaryBudget = Math.round((secondaryBudget - share) * 1e6) / 1e6;
    }

    const scaled = scaleContribution(contribution, share, turn);
    allocations.push({
      sponsorId: rel.sponsorId,
      isPrimary,
      share,
      contribution: scaled,
    });
    if (share > 0) marketParts.push(scaled);
  }

  // No relationships / no primary: contribution does not enter the shared market
  // via sphere routing (honest empty rather than a silent full dump).
  if (allocations.length === 0 && primaryId == null) {
    return {
      entityId: membership.entityId,
      marketContribution: scaleContribution(contribution, 0, turn),
      allocations,
    };
  }

  return {
    entityId: membership.entityId,
    marketContribution: mergeContributions(marketParts, turn),
    allocations,
  };
}
