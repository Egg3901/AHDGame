import type { ObjectId, Db } from "mongodb";
import { getGovernmentFormationsCollection } from "@/lib/db/collections/governmentFormation";
import type { CountryId } from "@/lib/constants/countries";
import { COUNTRY_ORDER } from "@/lib/constants/countries";
import { getCountryState } from "@/lib/countryState";
import type { ElectedOfficial } from "@/lib/db/types/officials";
import type { ParliamentaryGovernment } from "@/lib/db/types/parliamentaryGovernment";

/**
 * Head-of-government resolution for diplomatic auth and viewer-role lookups.
 *
 * Presidential countries (US): the head of government lives in the
 * `electedOfficials` collection with `officeType === "president"`.
 *
 * Parliamentary countries (UK, JP, DE): the canonical PM lives at
 * `governmentFormations.pmCharacterId`. We fall back to the legacy
 * `parliamentaryGovernments.pmCharacterId` when no formation row exists,
 * matching the convention in `requireCurrentPrimeMinister`.
 *
 * Querying `officials` for `primeMinister` does not work for parliamentary
 * countries because the PM is not seeded into officials.
 */

export async function getHeadOfGovernmentCharacterId(
  db: Db,
  countryId: CountryId
): Promise<ObjectId | null> {
  // Runtime governmentType: a post-Stage-4 conversion immediately picks
  // up the new head-of-government resolution path.
  const runtime = await getCountryState(db, countryId);
  if (runtime.governmentType === "presidential") {
    const row = await db.collection<ElectedOfficial>("electedOfficials").findOne({
      countryId,
      officeType: "president",
      characterId: { $ne: null },
    });
    return row?.characterId ?? null;
  }

  const formation = await getGovernmentFormationsCollection(db).findOne({ _id: countryId });
  if (formation) return formation.pmCharacterId ?? null;

  const legacy = await db
    .collection<ParliamentaryGovernment>("parliamentaryGovernments")
    .findOne({ _id: countryId as string });
  return legacy?.pmCharacterId ?? null;
}

/**
 * The head of government as a sponsor: id plus display name.
 *
 * Anything that FILES something in the government's name needs the name too, and
 * resolving it from the id at each call site duplicates the characters lookup.
 * Returns null when the office is vacant, or when the seat names a character the
 * characters collection no longer has.
 */
export async function getHeadOfGovernmentCharacter(
  db: Db,
  countryId: CountryId
): Promise<{ _id: ObjectId; name: string } | null> {
  const characterId = await getHeadOfGovernmentCharacterId(db, countryId);
  if (!characterId) return null;
  const character = await db
    .collection<{ _id: ObjectId; name?: string }>("characters")
    .findOne({ _id: characterId }, { projection: { name: 1 } });
  if (!character) return null;
  return { _id: characterId, name: character.name ?? "Head of Government" };
}

/**
 * Reverse lookup: which country (if any) is this character the head of
 * government of? Walks every active country once. Used by the
 * intorg "me" endpoint to gate UI buttons.
 */
export async function findCountryHeadedBy(
  db: Db,
  characterId: ObjectId
): Promise<CountryId | null> {
  const idStr = characterId.toString();

  const formations = await getGovernmentFormationsCollection(db)
    .find({ pmCharacterId: { $ne: null } })
    .toArray();
  const fmHit = formations.find((f) => f.pmCharacterId?.toString() === idStr);
  if (fmHit) return fmHit.countryId;

  const legacy = await db
    .collection<ParliamentaryGovernment>("parliamentaryGovernments")
    .find({ pmCharacterId: { $ne: null } })
    .toArray();
  const legacyHit = legacy.find((l) => l.pmCharacterId?.toString() === idStr);
  if (legacyHit) return legacyHit.countryId;

  // One lookup instead of a per-country getCountryState + findOne walk: a
  // character holds at most one presidency, so find the row first and only
  // then confirm that country is presidential.
  const row = await db.collection<ElectedOfficial>("electedOfficials").findOne({
    officeType: "president",
    characterId,
    countryId: { $in: COUNTRY_ORDER },
  });
  if (row) {
    const runtime = await getCountryState(db, row.countryId as CountryId);
    if (runtime.governmentType === "presidential") return row.countryId as CountryId;
  }

  return null;
}
