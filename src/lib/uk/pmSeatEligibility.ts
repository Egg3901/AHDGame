/**
 * A UK prime minister retains office only while holding a Commons seat.
 * hasRequiredPrimeMinisterSeat reads the seat register for player and NPP holders;
 * an explicitly pinned singleplayer head of state keeps the scenario's office.
 */
import type { Db, ObjectId } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";
import type { Character, ElectedOfficial } from "@/lib/db/types";
import { isSingleplayer } from "@/lib/singleplayer";

export async function hasRequiredPrimeMinisterSeat(
  db: Db,
  countryId: CountryId,
  characterId: ObjectId | null | undefined,
  nppId: ObjectId | null | undefined
): Promise<boolean> {
  if (countryId !== "UK") return true;
  if (characterId && isSingleplayer()) {
    const pinned = await db.collection<Character>("characters").findOne(
      {
        _id: characterId,
        countryId,
        singleplayerHeadOfState: true,
        retiredAt: { $exists: false },
      },
      { projection: { _id: 1 } }
    );
    if (pinned) return true;
  }
  if (!characterId && !nppId) return false;
  const officials = db.collection<ElectedOfficial>("electedOfficials");
  const projection = { projection: { _id: 1 } } as const;
  if (characterId) {
    const seat = await officials.findOne(
      { countryId, officeType: "commons", characterId },
      projection
    );
    return seat !== null;
  }
  if (!nppId) return false;
  const seat = await officials.findOne(
    { countryId, officeType: "commons", nppId, isNPP: true },
    projection
  );
  return seat !== null;
}
