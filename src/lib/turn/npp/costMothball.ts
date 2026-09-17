/**
 * Cost-loss mothballing. lossChronicityUpdates counts consecutive losing turns,
 * and chooseCostMothballSector selects a reversible shutdown after the limit.
 */
import type { ObjectId } from "mongodb";
import type { SectorProfitInfo } from "@/lib/turn/npp/sectorProfitability";
import type { NppSectorUpdateDoc } from "@/lib/turn/npp/corpDecisionTypes";

type SectorUpdate = { filter: { _id: ObjectId }; update: NppSectorUpdateDoc };

export function lossChronicityUpdates(
  sectorProfits: readonly SectorProfitInfo[],
  now: Date
): SectorUpdate[] {
  const updates: SectorUpdate[] = [];
  for (const sp of sectorProfits) {
    if (sp.sector.mothballed === true) continue;
    const prior = sp.sector.pnlLossTurns ?? 0;
    const next = sp.income < 0 ? prior + 1 : 0;
    if (next !== prior) {
      updates.push({
        filter: { _id: sp.sector._id },
        update: { $set: { pnlLossTurns: next, updatedAt: now } },
      });
    }
  }
  return updates;
}

export function chooseCostMothballSector(
  sectorProfits: readonly SectorProfitInfo[],
  excludedSectorIds: readonly ObjectId[],
  minimumLossTurns: number
): SectorProfitInfo | null {
  let coldest: { sp: SectorProfitInfo; lossTurns: number } | null = null;
  for (const sp of sectorProfits) {
    if (sp.sector.mothballed === true) continue;
    if (excludedSectorIds.includes(sp.sector._id)) continue;
    if (sp.sector.sectorType === "extraction" || sp.income >= 0) continue;
    const lossTurns = sp.sector.pnlLossTurns ?? 0;
    if (lossTurns < minimumLossTurns) continue;
    if (coldest == null || lossTurns > coldest.lossTurns) coldest = { sp, lossTurns };
  }
  return coldest?.sp ?? null;
}
