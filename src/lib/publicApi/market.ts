import type { Db, Sort, Filter } from "mongodb";
import type { Character, PoliticalParty } from "@/lib/db/types";
import { getOfficeLabel } from "@/lib/utils/politics";
import { buildCharacterHref } from "@/lib/utils/profileUrls";
import { COUNTRY_CURRENCY_MAP } from "@/lib/constants/currencies";
import type { CountryId } from "@/lib/constants/countries";
import { fetchExchangeRateMap, getRateDoc, toInternalAmount } from "@/lib/world/forex";

const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL || "https://ahousedividedgame.com";

/** Campaign balance with a legacy-`funds` fallback (matches the displayed value). */
function effectiveFunds(c: Character): number {
  const char = c as unknown as Record<string, unknown>;
  return (c.currencyBalances?.campaign as number) ?? (char.funds as number) ?? 0;
}

const METRIC_SORT: Record<string, Sort> = {
  npi: { nationalInfluence: -1, politicalInfluence: -1 },
  pi: { politicalInfluence: -1 },
  favorability: { favorability: -1 },
  actions: { actions: -1 },
  // "funds" is handled via an aggregation (below) so the sort key matches the
  // displayed value: campaign balance with a legacy-`funds` fallback. A plain
  // sort on one field would rank un-migrated (legacy-only) characters as 0 even
  // though they display a nonzero balance.
};

export async function queryLeaderboard(
  db: Db,
  params: { country?: string; metric?: string; limit?: number }
) {
  const { country, metric = "npi", limit = 10 } = params;
  const limitN = Math.max(1, Math.min(limit, 50));
  const sort = METRIC_SORT[metric] ?? METRIC_SORT.npi;

  // Exclude characters whose owning user is banned. We use an aggregation for
  // both branches so the banned-user filter is consistent across metrics.
  const basePipeline: Record<string, unknown>[] = [
    ...(country ? [{ $match: { countryId: country } }] : []),
    {
      $lookup: {
        from: "users",
        // Typed equality join (userId and users._id are both ObjectIds) so the
        // _id index is used. The previous $expr compared $toString(_id) to the
        // raw ObjectId, which never matched and skipped the index.
        localField: "userId",
        foreignField: "_id",
        pipeline: [{ $project: { isBanned: 1 } }],
        as: "_user",
      },
    },
    { $addFields: { _userDoc: { $arrayElemAt: ["$_user", 0] } } },
    { $match: { $or: [{ "_userDoc.isBanned": { $ne: true } }, { _userDoc: null }] } },
  ];

  // Exchange rates let us normalize local-currency funds to internal units. Raw
  // funds are not comparable across countries (e.g. £ vs $), so cross-country
  // funds ranking must sort on the normalized value.
  const rateMap = await fetchExchangeRateMap(db);

  let characters: Character[];
  if (metric === "funds") {
    // Pull all (banned-filtered) candidates and rank by internal-unit funds in
    // JS — a country-less query mixes currencies, so an in-DB sort on raw funds
    // would be meaningless. Consistent with the global leaderboard's full scan.
    const candidates = await db
      .collection<Character>("characters")
      .aggregate<Character>([...basePipeline, { $project: { _user: 0, _userDoc: 0 } }])
      .toArray();

    characters = candidates
      .map((c) => ({
        c,
        internal: toInternalAmount(effectiveFunds(c), getRateDoc(rateMap, c.countryId)),
      }))
      .sort((a, b) => b.internal - a.internal)
      .slice(0, limitN)
      .map((x) => x.c);
  } else {
    characters = await db
      .collection<Character>("characters")
      .aggregate<Character>([
        ...basePipeline,
        { $sort: sort },
        { $limit: limitN },
        { $project: { _user: 0, _userDoc: 0 } },
      ])
      .toArray();
  }

  if (characters.length === 0) return { found: false, metric, characters: [] };

  // Resolve parties by (sequentialId, countryId) so shared sequentialIds across
  // countries do not collide and global (country-less) queries still show
  // correct party names.
  const partyKeys = [
    ...new Map(
      characters
        .filter((c) => c.party && Number.isFinite(Number(c.party)))
        .map((c) => [
          `${c.countryId}:${c.party}`,
          { countryId: c.countryId, sequentialId: Number(c.party) },
        ])
    ).values(),
  ];

  const parties =
    partyKeys.length > 0
      ? await db
          .collection<PoliticalParty>("politicalParties")
          .find({
            $or: partyKeys.map((k) => ({ countryId: k.countryId, sequentialId: k.sequentialId })),
          } as Filter<PoliticalParty>)
          .toArray()
      : [];

  const partyMap = new Map(parties.map((p) => [`${p.countryId}:${String(p.sequentialId)}`, p]));

  const result = characters.map((c, i) => {
    const party = c.party ? partyMap.get(`${c.countryId}:${c.party}`) : undefined;
    const char = c as unknown as Record<string, unknown>;
    const funds = effectiveFunds(c);
    return {
      rank: i + 1,
      id: c._id.toString(),
      name: c.name,
      party: party?.name ?? "Independent",
      partyColor: party?.color ?? "#666666",
      stateCode: c.homeState,
      position: getOfficeLabel(c.currentOffice),
      politicalInfluence: c.politicalInfluence ?? 0,
      // Normalise: some DB records use nationalInfluence, others nationalPoliticalInfluence
      nationalInfluence:
        (char.nationalInfluence as number) ?? (char.nationalPoliticalInfluence as number) ?? 0,
      favorability: c.favorability ?? 50,
      actions: (char.actions as number) ?? 0,
      // `funds` is the raw local-currency balance; `fundsInternal` is the
      // forex-normalized value the funds ranking sorts on; `nativeCurrencyCode`
      // lets clients format `funds` with the right symbol.
      funds,
      fundsInternal: toInternalAmount(funds, getRateDoc(rateMap, c.countryId)),
      nativeCurrencyCode: COUNTRY_CURRENCY_MAP[c.countryId as CountryId] ?? "USD",
      profileUrl: `${BASE_URL}${buildCharacterHref(c)}`,
    };
  });

  return { found: true, metric, characters: result };
}
