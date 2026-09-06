import type { Db, ObjectId } from "mongodb";
import type { Character, ElectedOfficial, NPP, OfficeType } from "@/lib/db/types";
import { COUNTRY_CONFIGS, getCountryConfig, type CountryId } from "@/lib/constants/countries";
import { getExecutiveOfficialFilter } from "@/lib/elections/executiveOfficeFilters";
import { appointPrimeMinister } from "@/lib/turn/parliamentaryGovernment";
import { isSingleplayer } from "@/lib/singleplayer";

/** Countries where the authored executive path is a directly seated office. */
export function getSingleplayerHeadOfStateOfficeType(
  countryId: CountryId,
  preset?: string
): string | null {
  const config = getCountryConfig(countryId, preset);
  // Seat the governing executive in HoS mode: presidents for presidential
  // systems, and the authored executive office (PM/chancellor/premier) for
  // parliamentary and one-party systems. This avoids assigning a ceremonial
  // president where the playable office is the head of government.
  if (config.governmentType === "presidential") return "president";
  return config.officeTypes.find((office) => office.isExecutive)?.key ?? null;
}

/**
 * Seat the local character through the same electedOfficials/currentOffice
 * records consumed by the game. This is intentionally local-only: callers
 * must prove the singleplayer config before invoking it.
 */
export async function seatSingleplayerHeadOfState(
  db: Db,
  args: { characterId: ObjectId; countryId: CountryId; now: Date; preset?: string }
): Promise<boolean> {
  const officeType = getSingleplayerHeadOfStateOfficeType(args.countryId, args.preset);
  if (!officeType) return false;
  const character = await db.collection<Character>("characters").findOne({ _id: args.characterId });
  if (!character || character.countryId !== args.countryId) return false;

  if (officeType === "primeMinister") {
    await appointPrimeMinister(
      db,
      args.countryId,
      args.characterId,
      null,
      character.name,
      args.now,
      args.preset
    );
    return true;
  }

  const office: OfficeType =
    officeType === "president" ? { type: "president" } : ({ type: officeType } as OfficeType);
  const filter: Record<string, unknown> =
    officeType === "president"
      ? getExecutiveOfficialFilter(args.countryId, "president")
      : { countryId: args.countryId, officeType };

  await db.collection<ElectedOfficial>("electedOfficials").updateMany(
    { countryId: args.countryId, officeType, characterId: { $ne: args.characterId } },
    {
      $set: {
        characterId: null,
        characterName: null,
        party: null,
        isNPP: false,
        updatedAt: args.now,
      },
      $unset: { nppId: "" },
    }
  );
  await db
    .collection<NPP>("npps")
    .updateMany(
      { countryId: args.countryId, "currentOffice.type": officeType },
      { $set: { currentOffice: null, updatedAt: args.now } }
    );
  await db.collection<Character>("characters").updateMany(
    {
      countryId: args.countryId,
      "currentOffice.type": officeType,
      _id: { $ne: args.characterId },
    },
    { $set: { currentOffice: null, updatedAt: args.now } }
  );
  await db.collection<ElectedOfficial>("electedOfficials").updateOne(
    filter,
    {
      $set: {
        countryId: args.countryId,
        officeType,
        characterId: args.characterId,
        characterName: character.name,
        party: character.party,
        isNPP: false,
        electedAt: args.now,
        updatedAt: args.now,
      },
      $unset: { nppId: "" },
      $setOnInsert: { createdAt: args.now },
    },
    { upsert: true }
  );
  await db
    .collection<Character>("characters")
    .updateOne({ _id: args.characterId }, { $set: { currentOffice: office, updatedAt: args.now } });
  return true;
}

export async function pinnedSingleplayerHeadOfState(
  db: Db,
  countryId: CountryId
): Promise<Character | null> {
  if (!isSingleplayer()) return null;
  return db.collection<Character>("characters").findOne({
    countryId,
    singleplayerHeadOfState: true,
    retiredAt: { $exists: false },
  });
}

export const SINGLEPLAYER_HEAD_OF_STATE_COUNTRIES = Object.values(COUNTRY_CONFIGS)
  .filter((config) => Boolean(getSingleplayerHeadOfStateOfficeType(config.id)))
  .map((config) => config.id);
