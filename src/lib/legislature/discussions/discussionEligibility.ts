import type { Db } from "mongodb";
import { getCountryConfig, getSubNationalLegislatureKey } from "@/lib/constants/countries";
import { getOfficeTypeForChamber } from "@/lib/legislature/chamberOfficeType";
import type { Character, ElectedOfficial } from "@/lib/db/types";
import type { BillDiscussionScope } from "./types";

/**
 * True when `character` holds a seat in the legislature/chamber the bill belongs to.
 * National: member of either chamber (same rule as the veto-override / co-sponsor paths).
 * State: member of the sub-national chamber in that region.
 */
export async function canPostBillDiscussion(
  db: Db,
  character: Character,
  scope: BillDiscussionScope
): Promise<boolean> {
  if (scope.kind === "national") {
    const config = getCountryConfig(scope.countryId);
    const lowerKey = config.legislature.lowerChamber.key;
    const upperKey = config.upperElectionSystem
      ? (config.legislature.upperChamber?.key ?? null)
      : null;
    const chamberKeys = upperKey ? [lowerKey, upperKey] : [lowerKey];
    // Map chamber keys → stored officeTypes. Identity for every country except
    // CN, where chamber key "npc" is stored as officeType "npcDelegate". Mirrors
    // the membership resolution in nationalBillQueries.
    const officeTypes = chamberKeys.map((key) => getOfficeTypeForChamber(scope.countryId, key));
    const official = await db.collection<ElectedOfficial>("electedOfficials").findOne({
      characterId: character._id,
      officeType: { $in: officeTypes },
      countryId: scope.countryId,
    });
    return Boolean(official);
  }

  const official = await db.collection<ElectedOfficial>("electedOfficials").findOne({
    characterId: character._id,
    officeType: getSubNationalLegislatureKey(scope.countryId),
    state: scope.stateId.toUpperCase(),
    countryId: scope.countryId,
  });
  return Boolean(official);
}
