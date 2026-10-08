import type { Db } from "mongodb";
import type { Corporation } from "@/lib/db/types";
import { SETTLEMENT_HISTORY_EXCLUDED } from "@/lib/banking/settlementHistory";

/**
 * Returns the singleton IMF institution corporation (USD balance sheet; CEO set via admin seed).
 */
export async function getImfCorporation(db: Db): Promise<Corporation | null> {
  return db
    .collection<Corporation>("corporations")
    .findOne({ imfInstitution: true }, { projection: SETTLEMENT_HISTORY_EXCLUDED });
}
