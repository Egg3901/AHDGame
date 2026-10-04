import type { ObjectId, Db } from "mongodb";
import { getGovernmentFormationsCollection } from "@/lib/db/collections/governmentFormation";
import type { CountryId } from "@/lib/constants/countries";
import {
  COUNTRY_ORDER,
  getCountryConfig,
  getExecutiveOfficeKey,
  getHeadOfGovernmentOfficeKey,
} from "@/lib/constants/countries";
import { getGameStatePreset } from "@/lib/db/collections/gameState";
import { getCountryState, primeCountryStates } from "@/lib/countryState";
import type { ElectedOfficial } from "@/lib/db/types/officials";
import type { ParliamentaryGovernment } from "@/lib/db/types/parliamentaryGovernment";

/**
 * Head-of-government resolution for diplomatic auth and viewer-role lookups.
 *
 * Presidential countries (US): the head of government lives in the
 * `electedOfficials` collection with `officeType === "president"`.
 * Romania's 2027 semi-presidential configuration has a separate parliamentary
 * prime minister, so its head of government uses the formation record.
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
    const preset = await getGameStatePreset(db);
    const config = getCountryConfig(countryId, preset);
    if (
      config.electionSystems.headOfGovernment === "parliamentary" &&
      getHeadOfGovernmentOfficeKey(countryId, preset) !== getExecutiveOfficeKey(countryId, preset)
    ) {
      const formation = await getGovernmentFormationsCollection(db).findOne({ _id: countryId });
      return formation?.pmCharacterId ?? null;
    }
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

/** Resolve country heads together, sharing country-state, formation, and president reads. */
export async function getHeadOfGovernmentCharacterIds(
  db: Db,
  countryIds: readonly CountryId[]
): Promise<Map<CountryId, ObjectId | null>> {
  const uniqueCountryIds = [...new Set(countryIds)];
  if (uniqueCountryIds.length === 0) return new Map();

  await primeCountryStates(db, uniqueCountryIds);
  const runtimeStates = await Promise.all(
    uniqueCountryIds.map(
      async (countryId) => [countryId, await getCountryState(db, countryId)] as const
    )
  );
  const runtimeByCountry = new Map(runtimeStates);
  const presidentialCountries = uniqueCountryIds.filter(
    (countryId) => runtimeByCountry.get(countryId)?.governmentType === "presidential"
  );
  const preset = presidentialCountries.length ? await getGameStatePreset(db) : undefined;
  const separatePmCountries = new Set(
    presidentialCountries.filter(
      (countryId) =>
        getCountryConfig(countryId, preset).electionSystems.headOfGovernment === "parliamentary" &&
        getHeadOfGovernmentOfficeKey(countryId, preset) !== getExecutiveOfficeKey(countryId, preset)
    )
  );
  const presidentCountries = presidentialCountries.filter(
    (countryId) => !separatePmCountries.has(countryId)
  );
  const formationCountries = uniqueCountryIds.filter(
    (countryId) =>
      runtimeByCountry.get(countryId)?.governmentType !== "presidential" ||
      separatePmCountries.has(countryId)
  );

  const [formations, presidents] = await Promise.all([
    formationCountries.length
      ? getGovernmentFormationsCollection(db)
          .find({ _id: { $in: formationCountries } })
          .toArray()
      : Promise.resolve([]),
    presidentCountries.length
      ? db
          .collection<ElectedOfficial>("electedOfficials")
          .find({
            countryId: { $in: presidentCountries },
            officeType: "president",
            characterId: { $ne: null },
          })
          .toArray()
      : Promise.resolve([]),
  ]);
  const formationByCountry = new Map(formations.map((formation) => [formation._id, formation]));
  const presidentByCountry = new Map<CountryId, ObjectId>();
  for (const president of presidents) {
    const countryId = president.countryId as CountryId;
    if (president.characterId && !presidentByCountry.has(countryId)) {
      presidentByCountry.set(countryId, president.characterId);
    }
  }

  const legacyCountries = formationCountries.filter(
    (countryId) => !separatePmCountries.has(countryId) && !formationByCountry.has(countryId)
  );
  const legacyGovernments = legacyCountries.length
    ? await db
        .collection<ParliamentaryGovernment>("parliamentaryGovernments")
        .find({ _id: { $in: legacyCountries } })
        .toArray()
    : [];
  const legacyByCountry = new Map(
    legacyGovernments.map((government) => [government._id as CountryId, government])
  );

  return new Map(
    uniqueCountryIds.map((countryId) => {
      if (separatePmCountries.has(countryId)) {
        return [countryId, formationByCountry.get(countryId)?.pmCharacterId ?? null] as const;
      }
      if (presidentByCountry.has(countryId)) {
        return [countryId, presidentByCountry.get(countryId)!] as const;
      }
      if (runtimeByCountry.get(countryId)?.governmentType === "presidential") {
        return [countryId, null] as const;
      }
      const formation = formationByCountry.get(countryId);
      if (formation) return [countryId, formation.pmCharacterId ?? null] as const;
      return [countryId, legacyByCountry.get(countryId)?.pmCharacterId ?? null] as const;
    })
  );
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
