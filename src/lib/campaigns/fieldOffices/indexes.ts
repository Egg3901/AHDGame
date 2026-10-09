import type { Db } from "mongodb";
import type { CampaignFieldOffice } from "@/lib/db/types";
import { FIELD_OFFICES_COLLECTION } from "./commands";

export const FIELD_OFFICE_UNIQUE_SUBDIVISION_INDEX = "campaignFieldOffices_campaign_subdivision";

/**
 * Engine reads by election, the campaign room by campaign, and county-scope
 * offices are unique per (campaign, county). Region-scope offices carry a null
 * subdivision and stack, so the uniqueness is partial on string ids only.
 */
export async function ensureFieldOfficeIndexes(db: Db): Promise<void> {
  const col = db.collection<CampaignFieldOffice>(FIELD_OFFICES_COLLECTION);
  await col.createIndex({ electionId: 1 }, { name: "campaignFieldOffices_electionId" });
  await col.createIndex(
    { campaignId: 1, regionId: 1 },
    { name: "campaignFieldOffices_campaign_region" }
  );
  await col.createIndex(
    { campaignId: 1, subdivisionId: 1 },
    {
      name: FIELD_OFFICE_UNIQUE_SUBDIVISION_INDEX,
      unique: true,
      partialFilterExpression: { subdivisionId: { $type: "string" } },
    }
  );
}
