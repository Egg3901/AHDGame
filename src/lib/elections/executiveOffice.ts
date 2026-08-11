import type { Db } from "mongodb";
import { COUNTRY_CONFIGS, COUNTRY_ORDER, type CountryId } from "@/lib/constants/countries";
import type { Character, ElectedOfficial } from "@/lib/db/types";
import type { OfficeType } from "@/lib/db/types/character";

/** Cabinet `currentOffice.type` values that carry a `positionId`. */
const CABINET_OFFICE_TYPES = new Set([
  "usCabinet",
  "ukCabinet",
  "parliamentaryCabinet",
  "deCabinet",
]);

/**
 * Every national-executive office key across all countries: offices flagged
 * `isExecutive` and NOT `isSubNational` (matching getExecutiveOfficeKey's
 * filter). Covers heads of government (president/primeMinister/chancellor/
 * taoiseach/premier), deputies (vicePresident/tanaiste), and ceremonial heads
 * of state (uachtaran, CN ceremonial president). Computed once at module load.
 */
const EXECUTIVE_OFFICE_KEYS: ReadonlySet<string> = (() => {
  const keys = new Set<string>();
  for (const id of COUNTRY_ORDER) {
    for (const office of COUNTRY_CONFIGS[id].officeTypes) {
      if (office.isExecutive && !office.isSubNational) keys.add(office.key);
    }
  }
  return keys;
})();

export function getExecutiveOfficeKeys(): ReadonlySet<string> {
  return EXECUTIVE_OFFICE_KEYS;
}

/**
 * True when `currentOffice` is a national executive office. Two shapes:
 *  - directly-typed executive (`{ type: "president" }`, `{ type: "primeMinister" }`, …)
 *  - a cabinet office whose `positionId` is itself an executive key — i.e. a
 *    deputy head of government seated through the cabinet (IE Tánaiste:
 *    `{ type: "parliamentaryCabinet", positionId: "tanaiste" }`).
 */
export function isExecutiveOffice(currentOffice: OfficeType | null | undefined): boolean {
  if (!currentOffice) return false;
  if (EXECUTIVE_OFFICE_KEYS.has(currentOffice.type)) return true;
  if (
    CABINET_OFFICE_TYPES.has(currentOffice.type) &&
    "positionId" in currentOffice &&
    typeof currentOffice.positionId === "string" &&
    EXECUTIVE_OFFICE_KEYS.has(currentOffice.positionId)
  ) {
    return true;
  }
  return false;
}

/**
 * Character IDs (as strings) of every player who currently holds a national
 * executive office across the given countries. Two signals, unioned:
 *  - `currentOffice` satisfies `isExecutiveOffice` (elected execs + Tánaiste)
 *  - an `electedOfficials` row with an executive `officeType` names them — this
 *    catches CN's ceremonial President, which is keyed off the CCP chair and
 *    never written to `currentOffice` (see partyChairHeadOfState.ts).
 */
export async function getExecutiveCharacterIds(
  db: Db,
  memberCountries: CountryId[]
): Promise<Set<string>> {
  const ids = new Set<string>();

  const chars = await db
    .collection<Character>("characters")
    .find({ countryId: { $in: memberCountries }, userId: { $exists: true } })
    .project<Pick<Character, "_id" | "currentOffice">>({ _id: 1, currentOffice: 1 })
    .toArray();
  for (const c of chars) {
    if (isExecutiveOffice(c.currentOffice)) ids.add(c._id.toString());
  }

  const officials = await db
    .collection<ElectedOfficial>("electedOfficials")
    .find({
      countryId: { $in: memberCountries },
      officeType: { $in: [...EXECUTIVE_OFFICE_KEYS] },
      characterId: { $ne: null },
    })
    .project<Pick<ElectedOfficial, "characterId">>({ characterId: 1 })
    .toArray();
  for (const o of officials) {
    if (o.characterId) ids.add(o.characterId.toString());
  }

  return ids;
}
