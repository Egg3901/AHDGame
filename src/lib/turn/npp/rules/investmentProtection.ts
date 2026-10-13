/**
 * NPP investment protection keeps unfinished plants and gives new sectors time
 * to mature. isNppDivestmentProtected reserves the founding build window plus
 * 24 operating turns before automatic disposal can resume.
 */
import { CAPACITY_BUILD_TURNS } from "@/lib/constants/capacityEconomy";
import { getOperatingSectorType } from "@/lib/constants/sectorStrategies";
import type { CorporateSector } from "@/lib/db/types";

export const NPP_NEW_SECTOR_OPERATING_GRACE_TURNS = 24;

export function isNppDivestmentProtected(
  sector: Pick<
    CorporateSector,
    | "buildQueue"
    | "constructionInProgressAnchor"
    | "plantsStartTurn"
    | "nppFoundedTurn"
    | "sectorType"
    | "industryModel"
    | "mediaDiscriminator"
  >,
  turn: number
): boolean {
  // Keep even overdue queues until the build processor has settled them.
  if (sector.buildQueue?.length) return true;
  if (sector.constructionInProgressAnchor != null && sector.constructionInProgressAnchor !== 0)
    return true;
  const start = sector.nppFoundedTurn ?? sector.plantsStartTurn;
  // Legacy sectors without a plants start turn retain their existing policy.
  if (start == null) return false;
  if (!Number.isFinite(start) || !Number.isFinite(turn)) return true;
  const type = getOperatingSectorType(
    sector.sectorType,
    sector.industryModel,
    sector.mediaDiscriminator
  );
  const buildTurns = sector.plantsStartTurn != null ? CAPACITY_BUILD_TURNS(type, true) : 0;
  return turn < start + buildTurns + NPP_NEW_SECTOR_OPERATING_GRACE_TURNS;
}

/** A primary-only mandate excludes secondary industries and shortage overrides. */
export function allowsNppIndustryInvestment(
  primaryType: string,
  sectorType: string,
  primaryIndustryOnly: boolean
): boolean {
  return !primaryIndustryOnly || sectorType === primaryType;
}
