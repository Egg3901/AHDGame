import type { Db } from "@/lib/mongodb";
import type { Character, CareerEvent, ElectedOfficial, OfficeType } from "@/lib/db/types";
import { COUNTRY_CONFIGS } from "@/lib/constants/countries";
import {
  getExecutiveOfficialFilter,
  type ExecutiveOfficeType,
} from "@/lib/elections/executiveOfficeFilters";
import { getOfficeLabel } from "@/lib/utils/politics";

/** Vacate a US executive slot when the seated player resigns. */
export async function resignExecutiveOffice(
  db: Db,
  official: ElectedOfficial,
  character: Character,
  now: Date
): Promise<void> {
  const officeType = official.officeType;
  if (officeType !== "president" && officeType !== "vicePresident") {
    throw new Error("Not an executive office");
  }

  const countryId = official.countryId ?? COUNTRY_CONFIGS.US.id;
  const executiveOfficeType = officeType as ExecutiveOfficeType;

  await db
    .collection<ElectedOfficial>("electedOfficials")
    .updateOne(getExecutiveOfficialFilter(countryId, executiveOfficeType), {
      $set: {
        characterId: null,
        isNPP: false,
        updatedAt: now,
      },
      $unset: {
        characterName: "",
        party: "",
        nppId: "",
        electedAt: "",
      },
    });

  const executiveOffice: OfficeType = { type: executiveOfficeType };
  const careerEvent: CareerEvent = {
    type: "resigned",
    office: executiveOffice,
    officeLabel: getOfficeLabel(executiveOffice, countryId),
    party: character.party,
    partyCountryId: countryId,
    date: now,
  };

  await db.collection<Character>("characters").updateOne(
    { _id: character._id },
    {
      $set: { currentOffice: null, updatedAt: now },
      $push: { careerHistory: careerEvent },
    }
  );
}
