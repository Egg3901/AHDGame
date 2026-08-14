import type { Db } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";
import { CABINET_SETTING_COOLDOWN_UNSET } from "@/lib/cabinet/settingCooldowns";
import type { CabinetSetting } from "@/lib/db/types/cabinetSetting";
import type { MinisterialOrder } from "@/lib/db/types/ministerialOrder";

export function getCabinetSettingsCollection(db: Db) {
  return db.collection<CabinetSetting>("cabinetSettings");
}

/**
 * Clears the per-holder rate-limit cooldowns on a cabinet position's settings
 * document so a newly seated minister can change settings immediately instead of
 * inheriting their predecessor's 24-turn (per lever) / once-per-turn (allocation)
 * cooldown. Policy values (tierSetting, allocationPercents, etc.) are preserved
 * for continuity of government. No-op when the position has no settings document
 * yet — deliberately not an upsert, so vacant positions stay clean.
 *
 * Call this at every holder-seating point (US confirmation/acting appointment,
 * parliamentary appointment); the settings doc is keyed by position, not holder.
 */
export async function resetCabinetSettingCooldowns(
  db: Db,
  countryId: CountryId,
  positionId: string
): Promise<void> {
  await getCabinetSettingsCollection(db).updateOne(
    { _id: `${countryId}_${positionId}` },
    { $unset: { ...CABINET_SETTING_COOLDOWN_UNSET } }
  );
}

export function getMinisterialOrdersCollection(db: Db) {
  return db.collection<MinisterialOrder>("ministerialOrders");
}
