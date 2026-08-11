import { getDb } from "@/lib/mongodb";
import { type CountryId } from "@/lib/constants/countries";
import { getOfficeLabel } from "@/lib/utils/politics";
import type { Character, NPP, PoliticalParty } from "@/lib/db/types";
import type { PoliticianData } from "@/lib/politicians/types";

export interface PoliticiansResult {
  politicians: PoliticianData[];
  playerCount: number;
  nppCount: number;
}

type PoliticianCharacter = Pick<
  Character,
  | "_id"
  | "sequentialId"
  | "name"
  | "avatarUrl"
  | "party"
  | "countryId"
  | "homeState"
  | "currentOffice"
  | "politicalInfluence"
  | "nationalInfluence"
  | "favorability"
  | "funds"
  | "currencyBalances"
> & {
  _userRole?: string;
  _userIsAdmin?: boolean;
};

export async function fetchPoliticians(countryId: CountryId): Promise<PoliticiansResult> {
  const db = await getDb();
  const countryFilter = { countryId };

  const [characters, npps] = await Promise.all([
    db
      .collection<Character>("characters")
      .aggregate<PoliticianCharacter>([
        { $match: countryFilter },
        {
          $lookup: {
            from: "users",
            // Typed equality join (userId and users._id are both ObjectIds) so
            // the _id index is used. The previous $expr compared $toString(_id)
            // to the raw ObjectId, which never matched and skipped the index.
            localField: "userId",
            foreignField: "_id",
            pipeline: [{ $project: { isBanned: 1, role: 1, isAdmin: 1 } }],
            as: "_user",
          },
        },
        { $addFields: { _userDoc: { $arrayElemAt: ["$_user", 0] } } },
        { $match: { $or: [{ "_userDoc.isBanned": { $ne: true } }, { _userDoc: null }] } },
        { $sort: { politicalInfluence: -1, name: 1 } },
        {
          $project: {
            _id: 1,
            sequentialId: 1,
            name: 1,
            avatarUrl: 1,
            party: 1,
            countryId: 1,
            homeState: 1,
            currentOffice: 1,
            politicalInfluence: 1,
            nationalInfluence: 1,
            favorability: 1,
            funds: 1,
            currencyBalances: 1,
            _userRole: "$_userDoc.role",
            _userIsAdmin: "$_userDoc.isAdmin",
          },
        },
      ])
      .toArray(),
    db
      .collection<NPP>("npps")
      .find({ retiredAt: null, ...countryFilter })
      .project({
        _id: 1,
        name: 1,
        avatarUrl: 1,
        party: 1,
        countryId: 1,
        homeState: 1,
        currentOffice: 1,
        politicalInfluence: 1,
        favorability: 1,
      })
      .sort({ politicalInfluence: -1, name: 1 })
      .toArray(),
  ]);

  const allHomeStateIds = [
    ...new Set(
      [...characters.map((c) => c.homeState as string), ...npps.map((n) => n.homeState)].filter(
        Boolean
      )
    ),
  ];
  const [stateNameDocs, partyDocs] = await Promise.all([
    db
      .collection<{ _id: string; name: string }>("states")
      .find({ _id: { $in: allHomeStateIds } }, { projection: { name: 1 } })
      .toArray(),
    db
      .collection<PoliticalParty>("politicalParties")
      .find({ countryId }, { projection: { sequentialId: 1, name: 1, color: 1, countryId: 1 } })
      .toArray(),
  ]);
  const stateNameMap = new Map(stateNameDocs.map((s) => [s._id, s.name]));

  const partyMap = new Map(
    partyDocs.map((p) => [
      String(p.sequentialId),
      { name: p.name, color: p.color, countryId: p.countryId },
    ])
  );

  const playerPoliticians: PoliticianData[] = characters.map((character) => {
    const partyInfo = partyMap.get(character.party);
    const charCountry: CountryId = character.countryId ?? "US";
    return {
      id: character._id.toString(),
      sequentialId: character.sequentialId,
      name: character.name,
      avatarUrl: character.avatarUrl ?? undefined,
      party: character.party,
      partyName: partyInfo?.name,
      partyColor: partyInfo?.color,
      countryId: charCountry,
      homeState: character.homeState,
      homeStateName: stateNameMap.get(character.homeState) ?? character.homeState,
      currentOffice: getOfficeLabel(character.currentOffice, charCountry),
      officeType: character.currentOffice?.type ?? null,
      politicalInfluence: character.politicalInfluence || 0,
      nationalInfluence: character.nationalInfluence ?? 0,
      favorability: character.favorability ?? 50,
      // LOCAL home-currency balance (canonical source of truth) — fixes
      // in-game bug #0553 where the politicians-list card displayed the
      // stale anchor mirror (e.g. -$2.4M for a character with $208K real
      // balance under floating FX).
      funds: character.currencyBalances?.campaign ?? character.funds ?? 0,
      isNPP: false,
      isAdmin: character._userIsAdmin === true || character._userRole === "admin",
      isModerator:
        character._userRole === "moderator" ||
        character._userRole === "admin" ||
        character._userIsAdmin === true,
    };
  });

  const nppPoliticians: PoliticianData[] = npps.map((npp) => {
    const partyInfo = partyMap.get(npp.party);
    const nppCountry: CountryId = npp.countryId ?? "US";
    return {
      id: npp._id.toString(),
      name: npp.name,
      avatarUrl: npp.avatarUrl ?? undefined,
      party: npp.party,
      partyName: partyInfo?.name,
      partyColor: partyInfo?.color,
      countryId: nppCountry,
      homeState: npp.homeState,
      homeStateName: stateNameMap.get(npp.homeState) ?? npp.homeState,
      currentOffice: getOfficeLabel(npp.currentOffice, nppCountry),
      officeType: npp.currentOffice?.type ?? null,
      politicalInfluence: npp.politicalInfluence || 0,
      nationalInfluence: 0,
      favorability: npp.favorability ?? 50,
      funds: null,
      isNPP: true,
    };
  });

  const allPoliticians = [...playerPoliticians, ...nppPoliticians].sort(
    (a, b) => b.politicalInfluence - a.politicalInfluence
  );

  return {
    politicians: allPoliticians,
    playerCount: playerPoliticians.length,
    nppCount: nppPoliticians.length,
  };
}
