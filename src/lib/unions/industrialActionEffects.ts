import type { Db } from "mongodb";
import type { BargainingCampaign } from "@/lib/db/types";
import { OVERTIME_BAN_OUTPUT_FACTOR } from "@/lib/unions/bargaining";

/** Load non-strike industrial action once for the corporation turn. */
export async function loadIndustrialActionOutputFactors(db: Db): Promise<Map<string, number>> {
  const campaigns = await db
    .collection<BargainingCampaign>("bargainingCampaigns")
    .find({ status: "dispute", escalationLevel: "overtime_ban" }, { projection: { sectorIds: 1 } })
    .toArray();

  const factors = new Map<string, number>();
  for (const campaign of campaigns) {
    for (const sectorId of campaign.sectorIds) {
      const key = sectorId.toString();
      factors.set(key, Math.min(factors.get(key) ?? 1, OVERTIME_BAN_OUTPUT_FACTOR));
    }
  }
  return factors;
}
