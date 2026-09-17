// src/lib/turn/npp/nppWagePolicy.ts
/**
 * NPP wage policy for labour wages+ worlds.
 *
 * Quality, unionization and labour cost all hang off wageLevel. Player CEOs
 * set it; NPP CEOs use this pass instead: shortage plus healthy margins pays
 * up for quality, glut or losses cut toward the floor. Steps bound per turn so
 * a shock does not rewrite the wage bill in one tick. Union floors apply at
 * cost time (collectiveAgreementEffects) and are not written here.
 */
import type { ObjectId } from "mongodb";
import type { Corporation } from "@/lib/db/types";
import { clampWageLevel } from "@/lib/labour/laborCost";
import { sectorShortageScore, type CommodityPriceRatioFn } from "@/lib/turn/npp/marketSignals";
import { CHRONIC_LOW_FILL_THRESHOLD } from "@/lib/turn/npp/strategyExpectedRevenue";
import type { SectorProfitInfo } from "@/lib/turn/npp/sectorProfitability";
import type { NppSectorUpdateDoc } from "@/lib/turn/npp/corpDecisionTypes";
import {
  NPP_WAGE_BASELINE,
  NPP_WAGE_GLUT_TARGET,
  NPP_WAGE_SHORTAGE_TARGET,
  NPP_WAGE_STEP,
} from "@/lib/turn/npp/nppCorporationTuning";

export type NppWageSectorUpdate = {
  filter: { _id: ObjectId };
  update: NppSectorUpdateDoc;
};

/** Append one wage-level write per eligible sector, at most one step each. */
export function pushNppWageUpdates(args: {
  corp: Pick<Corporation, "countryId">;
  sectorProfits: SectorProfitInfo[];
  divestedSectorIds: ObjectId[];
  priceRatioOf: CommodityPriceRatioFn;
  now: Date;
  sectorUpdates: NppWageSectorUpdate[];
}): void {
  const { corp, sectorProfits, divestedSectorIds, priceRatioOf, now } = args;
  for (const sp of sectorProfits) {
    if (divestedSectorIds.includes(sp.sector._id)) continue;
    if (sp.sector.mothballed === true) continue;
    const chronicLowFill =
      sp.sector.soldFraction != null && sp.sector.soldFraction < CHRONIC_LOW_FILL_THRESHOLD;
    const shortage = sectorShortageScore(
      sp.sector.sectorType,
      sp.sector.countryId ?? corp.countryId,
      priceRatioOf
    );
    let target = NPP_WAGE_BASELINE;
    if (chronicLowFill || sp.marginCategory === "loss" || shortage <= 0.85) {
      target = NPP_WAGE_GLUT_TARGET;
    } else if (
      shortage >= 1.15 &&
      (sp.marginCategory === "healthy" || sp.marginCategory === "strong")
    ) {
      target = NPP_WAGE_SHORTAGE_TARGET;
    }
    const current = sp.sector.wageLevel ?? NPP_WAGE_BASELINE;
    const delta = Math.max(-NPP_WAGE_STEP, Math.min(NPP_WAGE_STEP, target - current));
    const next = clampWageLevel(Math.round((current + delta) * 100) / 100);
    if (next !== current) {
      args.sectorUpdates.push({
        filter: { _id: sp.sector._id },
        update: { $set: { wageLevel: next, updatedAt: now } },
      });
    }
  }
}
