import type { Db } from "mongodb";
import { ensureFieldOfficeIndexes } from "@/lib/campaigns/fieldOffices/indexes";

/**
 * Campaign field offices: the election lookup the vote engines use, the
 * campaign-room read, and the UNIQUE partial index that holds a campaign to
 * one office per county. Shares ensureFieldOfficeIndexes with the startup
 * migration so a fresh seed and a live world agree.
 */
export async function seedCampaignFieldOfficeIndexes(db: Db, log: (msg: string) => void) {
  log("Campaign field office indexes:");
  await ensureFieldOfficeIndexes(db);
  log("Campaign field office indexes ensured");
}
