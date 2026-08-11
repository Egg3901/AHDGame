import type { Db } from "mongodb";
import type { ElectedOfficial, Character, NPP, CareerEvent, OfficeType } from "@/lib/db/types";
import { COUNTRY_CONFIGS } from "@/lib/constants/countries";
import { getExecutiveOfficialFilter } from "@/lib/elections/executiveOfficeFilters";
import { getOfficeLabel } from "@/lib/utils/politics";
import { createNotifications } from "@/lib/notifications";
import {
  hasReachedExecutiveTermLimit,
  incrementExecutiveTermsServedUpdate,
} from "@/lib/elections/executiveTermLimits";

/**
 * Checks if the US president office is vacant and a VP exists.
 * If so, auto-promotes the VP to President and clears the VP office.
 * Runs each turn after election resolution (Group 11.5).
 */
export async function processPresidentialSuccession(db: Db): Promise<boolean> {
  const usCountryId = COUNTRY_CONFIGS.US.id;
  const presidentRecord = await db
    .collection<ElectedOfficial>("electedOfficials")
    .findOne(getExecutiveOfficialFilter(usCountryId, "president"));

  // No record at all means no election has ever happened; nothing to do.
  if (!presidentRecord) return false;

  // Not vacant if a character or NPP is assigned.
  const presidentVacant = presidentRecord.characterId === null && !presidentRecord.nppId;
  if (!presidentVacant) return false;

  const vpRecord = await db
    .collection<ElectedOfficial>("electedOfficials")
    .findOne(getExecutiveOfficialFilter(usCountryId, "vicePresident"));

  const vpFilled = vpRecord && (vpRecord.characterId !== null || vpRecord.nppId);
  if (!vpFilled || !vpRecord) return false;

  const now = new Date();
  let vpCharacter: Pick<
    Character,
    "_id" | "careerHistory" | "party" | "executiveTermsServed" | "userId" | "name"
  > | null = null;

  if (vpRecord.characterId) {
    vpCharacter = await db.collection<Character>("characters").findOne(
      { _id: vpRecord.characterId },
      {
        projection: {
          _id: 1,
          careerHistory: 1,
          party: 1,
          executiveTermsServed: 1,
          userId: 1,
          name: 1,
        },
      }
    );
    if (!vpCharacter) return false;
    if (hasReachedExecutiveTermLimit(vpCharacter, usCountryId)) {
      console.warn(
        `[Turn] Presidential succession blocked: VP ${vpRecord.characterId.toString()} has already reached the US presidential term limit`
      );
      return false;
    }
  }

  // Promote VP to President in electedOfficials only after confirming the move is legal.
  await db.collection<ElectedOfficial>("electedOfficials").updateOne(
    getExecutiveOfficialFilter(usCountryId, "president"),
    {
      $set: {
        countryId: usCountryId,
        characterId: vpRecord.characterId,
        characterName: vpRecord.characterName,
        party: vpRecord.party,
        isNPP: vpRecord.isNPP ?? false,
        ...(vpRecord.nppId ? { nppId: vpRecord.nppId } : {}),
        updatedAt: now,
      },
    },
    { upsert: true }
  );

  if (vpRecord.characterId && vpCharacter) {
    const presidentOffice: OfficeType = { type: "president" };
    const successionCareer: CareerEvent = {
      type: "appointed",
      office: presidentOffice,
      officeLabel: getOfficeLabel(presidentOffice, usCountryId),
      date: now,
    };
    if (vpCharacter.party) {
      successionCareer.party = vpCharacter.party;
      successionCareer.partyCountryId = usCountryId;
    }
    await db.collection<Character>("characters").updateOne(
      { _id: vpRecord.characterId },
      {
        $set: {
          currentOffice: presidentOffice,
          updatedAt: now,
          ...incrementExecutiveTermsServedUpdate(vpCharacter, usCountryId),
        },
        $push: { careerHistory: successionCareer },
      }
    );

    await createNotifications([
      {
        userId: vpCharacter.userId,
        type: "general_win",
        title: "Succession — President of the United States",
        message: `${vpCharacter.name} has succeeded to the presidency following a vacancy in the office.`,
        metadata: {},
      },
    ]);
  } else if (vpRecord.nppId) {
    await db
      .collection<NPP>("npps")
      .updateOne(
        { _id: vpRecord.nppId },
        { $set: { currentOffice: { type: "president" }, updatedAt: now } }
      );
  }

  // Clear VP office; characterId stays null (type allows it), optional fields are unset.
  await db
    .collection<ElectedOfficial>("electedOfficials")
    .updateOne(getExecutiveOfficialFilter(usCountryId, "vicePresident"), {
      $set: { characterId: null, countryId: usCountryId, isNPP: false, updatedAt: now },
      $unset: { characterName: "", party: "", nppId: "" },
    });

  return true;
}
