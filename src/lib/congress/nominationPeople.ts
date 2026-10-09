import { ObjectId, type Db } from "mongodb";
import type { Character, NPP, PoliticalParty } from "@/lib/db/types";
import type { CountryId } from "@/lib/constants/countries";
import { getPartyHex } from "@/lib/utils/politics";
import { buildCharacterHref, buildNppHref } from "@/lib/utils/profileUrls";

/** Display-ready person on a nomination card: portrait, profile link, party. */
export interface NominationPerson {
  name: string;
  href: string | null;
  avatarUrl: string | null;
  partyName: string | null;
  partyColor: string | null;
}

interface NominationPeopleSource {
  nomineeMode?: "character" | "npp";
  nomineeCharacterId?: ObjectId | null;
  nomineeNppId?: ObjectId | null;
  nomineeName: string;
  nomineeParty?: string;
  proposedByPresidentId?: ObjectId | null;
  proposedByPresidentName?: string;
}

/**
 * Resolves nominee + nominating president portraits, profile links and party
 * labels for a batch of nominations in three queries. `nomineeParty` stores the
 * party sequentialId, so the raw value is never shown; unknown parties render
 * without a label.
 */
export async function loadNominationPeople(
  db: Db,
  countryId: CountryId,
  noms: NominationPeopleSource[]
): Promise<{ nominee: NominationPerson; nominator: NominationPerson }[]> {
  const charIds = new Set<string>();
  const nppIds = new Set<string>();
  for (const n of noms) {
    if (n.nomineeMode === "npp" && n.nomineeNppId) nppIds.add(n.nomineeNppId.toString());
    else if (n.nomineeCharacterId) charIds.add(n.nomineeCharacterId.toString());
    if (n.proposedByPresidentId) charIds.add(n.proposedByPresidentId.toString());
  }

  const [chars, npps, parties] = await Promise.all([
    charIds.size > 0
      ? db
          .collection<Character>("characters")
          .find(
            { _id: { $in: [...charIds].map((id) => new ObjectId(id)) } },
            { projection: { _id: 1, sequentialId: 1, avatarUrl: 1, party: 1 } }
          )
          .toArray()
      : [],
    nppIds.size > 0
      ? db
          .collection<NPP>("npps")
          .find(
            { _id: { $in: [...nppIds].map((id) => new ObjectId(id)) } },
            { projection: { _id: 1, sequentialId: 1, avatarUrl: 1, party: 1 } }
          )
          .toArray()
      : [],
    db.collection<PoliticalParty>("politicalParties").find({ countryId }).toArray(),
  ]);
  const charMap = new Map(chars.map((c) => [c._id.toString(), c]));
  const nppMap = new Map(npps.map((p) => [p._id.toString(), p]));
  const partyMap = new Map(parties.map((p) => [String(p.sequentialId), p]));

  const partyFields = (slug: string | undefined) => {
    const party = slug ? partyMap.get(slug) : undefined;
    return party
      ? { partyName: party.name, partyColor: getPartyHex(slug!, party.color) }
      : { partyName: null, partyColor: null };
  };

  return noms.map((n) => {
    const nomineeNpp =
      n.nomineeMode === "npp" && n.nomineeNppId ? nppMap.get(n.nomineeNppId.toString()) : null;
    const nomineeChar =
      !nomineeNpp && n.nomineeCharacterId ? charMap.get(n.nomineeCharacterId.toString()) : null;
    const nomineeDoc = nomineeNpp ?? nomineeChar;
    const nominee: NominationPerson = {
      name: n.nomineeName,
      href: nomineeNpp
        ? buildNppHref(nomineeNpp)
        : nomineeChar
          ? buildCharacterHref(nomineeChar)
          : null,
      avatarUrl: nomineeDoc?.avatarUrl ?? null,
      ...partyFields(n.nomineeParty ?? nomineeDoc?.party),
    };

    const presidentChar = n.proposedByPresidentId
      ? charMap.get(n.proposedByPresidentId.toString())
      : null;
    const nominator: NominationPerson = {
      name: n.proposedByPresidentName ?? "President",
      href: presidentChar ? buildCharacterHref(presidentChar) : null,
      avatarUrl: presidentChar?.avatarUrl ?? null,
      ...partyFields(presidentChar?.party),
    };

    return { nominee, nominator };
  });
}
