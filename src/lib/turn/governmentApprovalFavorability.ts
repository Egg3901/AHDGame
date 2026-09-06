import type { Db, ObjectId } from "mongodb";
import type { Character, NPP } from "@/lib/db/types";
import type { CountryId } from "@/lib/constants/countries";
import { getHeadOfGovernmentCharacterId } from "@/lib/api/headOfGovernment";
import { getCountryState } from "@/lib/countryState";
import type { GovernmentFormation } from "@/lib/db/types/governmentFormation";
import type { ParliamentaryGovernment } from "@/lib/db/types/parliamentaryGovernment";
import type { ElectedOfficial } from "@/lib/db/types/officials";
export {
  governmentApprovalFavorabilityDrain,
  MAX_GOVERNMENT_APPROVAL_FAVORABILITY_DRAIN,
} from "./rules/governmentApprovalFavorability";

/** Resolve the actual head-of-government party using runtime regime state. */
export async function loadRulingExecutiveParties(db: Db): Promise<Map<CountryId, string>> {
  const [presidents, formations, parliamentary] = await Promise.all([
    db
      .collection<ElectedOfficial>("electedOfficials")
      .find(
        { officeType: "president" },
        { projection: { countryId: 1, characterId: 1, nppId: 1, party: 1 } }
      )
      .toArray(),
    db.collection<GovernmentFormation>("governmentFormations").find({}).toArray(),
    db
      .collection<ParliamentaryGovernment>("parliamentaryGovernments")
      .find({ _id: { $not: /_/ } })
      .toArray(),
  ]);

  const countryIds = new Set<CountryId>([
    ...formations.map((row) => row.countryId),
    ...parliamentary.map((row) => row.countryId),
    ...presidents.flatMap((row) => (row.countryId ? [row.countryId] : [])),
  ]);
  const runtimeTypes = new Map<CountryId, string>(
    await Promise.all(
      [...countryIds].map(
        async (countryId) =>
          [countryId, (await getCountryState(db, countryId)).governmentType] as const
      )
    )
  );
  const charIds: ObjectId[] = [
    ...formations.map((row) => row.pmCharacterId),
    ...parliamentary.map((row) => row.pmCharacterId),
    ...presidents.map((row) => row.characterId),
  ].filter((id): id is ObjectId => id != null);
  const headCharacterByCountry = new Map<CountryId, ObjectId>();
  const nppIds = [
    ...formations.flatMap((f) => [f.pmNppId, f.presidentNppId]),
    ...parliamentary.map((g) => g.pmNppId),
    ...presidents.map((p) => p.nppId),
  ].filter((id): id is ObjectId => id != null);
  for (const countryId of countryIds) {
    const id = await getHeadOfGovernmentCharacterId(db, countryId);
    if (id) {
      charIds.push(id);
      headCharacterByCountry.set(countryId, id);
    }
  }
  const loadParties = async <T extends { _id: ObjectId; countryId?: CountryId; party?: string }>(
    collectionName: string,
    ids: ObjectId[]
  ): Promise<T[]> => {
    if (ids.length === 0) return [];
    return db
      .collection<T>(collectionName)
      .find({ _id: { $in: ids } })
      .toArray();
  };
  const [pmCharacters, pmNpps] = await Promise.all([
    loadParties<Pick<Character, "_id" | "countryId" | "party">>("characters", charIds),
    loadParties<Pick<NPP, "_id" | "countryId" | "party">>("npps", nppIds),
  ]);
  const charsById = new Map(pmCharacters.map((c) => [`${c.countryId}:${c._id}`, c.party]));
  const nppsById = new Map(pmNpps.map((n) => [`${n.countryId}:${n._id}`, n.party]));
  const parties = new Map<CountryId, string>();

  for (const countryId of countryIds) {
    const presidential = runtimeTypes.get(countryId) === "presidential";
    const president = presidents.find((row) => row.countryId === countryId);
    const formation = formations.find((row) => row._id === countryId);
    const legacy = formation ? undefined : parliamentary.find((row) => row.countryId === countryId);
    const key = (id: ObjectId) => `${countryId}:${id}`;
    const characterId =
      headCharacterByCountry.get(countryId) ??
      (presidential ? president?.characterId : (formation?.pmCharacterId ?? legacy?.pmCharacterId));
    const nppId = presidential
      ? (president?.nppId ?? formation?.presidentNppId)
      : (formation?.pmNppId ?? legacy?.pmNppId);
    const party = characterId
      ? (charsById.get(key(characterId)) ?? (presidential ? president?.party : undefined))
      : nppId
        ? nppsById.get(key(nppId))
        : presidential
          ? president?.party
          : undefined;
    if (party) parties.set(countryId, party);
  }
  return parties;
}

export async function loadGovernmentApprovalByCountry(db: Db): Promise<Map<CountryId, number>> {
  const rows = await db
    .collection<{ _id: CountryId; approvalRating?: number }>("governmentApprovals")
    .find({}, { projection: { _id: 1, approvalRating: 1 } })
    .toArray();
  return new Map(
    rows
      .filter((r): r is { _id: CountryId; approvalRating: number } =>
        Number.isFinite(r.approvalRating)
      )
      .map((r) => [r._id, r.approvalRating])
  );
}
