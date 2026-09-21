/** Seated officeholders supply the atlas portraits and chamber breakdowns.
 * Vacant seats are excluded; multi-seat delegations retain their seat count.
 */
import type { Db } from "mongodb";
import type { Character, ElectedOfficial, NPP, PoliticalParty } from "@/lib/db/types";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { getPartyHex } from "@/lib/utils/politics";

export interface MapOfficeholder {
  id: string;
  name: string;
  office: string;
  party: string;
  partyName: string;
  color: string;
  avatarUrl: string | null;
  seats: number;
}

export async function computeMapOfficeholders(
  db: Db,
  countryId: CountryId,
  regionIds: readonly string[]
): Promise<Record<string, MapOfficeholder[]>> {
  const [officials, parties] = await Promise.all([
    db
      .collection<ElectedOfficial>("electedOfficials")
      .find(
        {
          officeType: { $in: ["senate", "house", "governor"] },
          state: { $in: [...regionIds] },
          ...(countryId === COUNTRY_CONFIGS.US.id
            ? { $or: [{ countryId }, { countryId: { $exists: false } }] }
            : { countryId }),
        },
        {
          projection: {
            _id: 1,
            state: 1,
            officeType: 1,
            characterId: 1,
            nppId: 1,
            characterName: 1,
            party: 1,
            seatsHeld: 1,
          },
        }
      )
      .toArray(),
    db
      .collection<PoliticalParty>("politicalParties")
      .find({ countryId }, { projection: { sequentialId: 1, name: 1, color: 1 } })
      .toArray(),
  ]);
  const filled = officials.filter((o) => o.characterId || o.nppId);
  const characterIds = filled.flatMap((o) => (o.characterId ? [o.characterId] : []));
  const nppIds = filled.flatMap((o) => (o.nppId ? [o.nppId] : []));
  const [characters, npps] = await Promise.all([
    characterIds.length
      ? db
          .collection<Character>("characters")
          .find({ _id: { $in: characterIds } }, { projection: { _id: 1, avatarUrl: 1 } })
          .toArray()
      : [],
    nppIds.length
      ? db
          .collection<NPP>("npps")
          .find({ _id: { $in: nppIds } }, { projection: { _id: 1, avatarUrl: 1 } })
          .toArray()
      : [],
  ]);
  const avatars = new Map(characters.map((c) => [String(c._id), c.avatarUrl]));
  const nppAvatars = new Map(npps.map((c) => [String(c._id), c.avatarUrl]));
  const result: Record<string, MapOfficeholder[]> = {};
  for (const o of filled) {
    if (!o.state) continue;
    const rawParty = o.party ?? "independent";
    const p = parties.find(
      (p) => String(p.sequentialId) === rawParty || p.name.toLowerCase() === rawParty.toLowerCase()
    );
    const party = p ? String(p.sequentialId) : rawParty;
    (result[o.state] ??= []).push({
      id: String(o._id),
      name: o.characterName ?? "Unknown",
      office: o.officeType,
      party,
      partyName: p?.name ?? rawParty,
      color: getPartyHex(party, p?.color),
      avatarUrl:
        (o.characterId ? avatars.get(String(o.characterId)) : nppAvatars.get(String(o.nppId))) ??
        null,
      seats: o.seatsHeld ?? 1,
    });
  }
  return result;
}
