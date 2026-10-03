/**
 * Deputies discuss bills in the legislature where they hold an actual seat.
 * canPostBillDiscussion follows current voting authority for national chambers
 * and the resident region for sub-national bills.
 */
import { loadRuntimeCountryOffices } from "@/lib/countries/runtimeOffices";
import { getVotingUpperChamberKey } from "@/lib/countries/rules/officeLayout";
import type { Db } from "mongodb";
import { getSubNationalLegislatureKey } from "@/lib/constants/countries";
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
    const { config } = await loadRuntimeCountryOffices(db, scope.countryId);
    const lowerKey = config.legislature.lowerChamber.key;
    const upperKey = getVotingUpperChamberKey(config);
    const chamberKeys = upperKey ? [lowerKey, upperKey] : [lowerKey];
    // Map chamber keys → stored officeTypes. Identity for every country except
    // CN, where chamber key "npc" is stored as officeType "npcDelegate". Mirrors
    // the membership resolution in nationalBillQueries.
    const officeTypes = chamberKeys.map((key) =>
      getOfficeTypeForChamber(scope.countryId, key, undefined, config)
    );
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
