import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { handleRouteError } from "@/lib/api/errors";
import { getOfficeLabel, getPartyHex } from "@/lib/utils/politics";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { COUNTRY_CURRENCY_MAP } from "@/lib/constants/currencies";
import { getAuthUser } from "@/lib/auth";
import { getEnabledCountryIds } from "@/lib/countryAccess";
import type { Character, NPP } from "@/lib/db/types";

const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL || "https://ahousedividedgame.com";

type Metric = "influence" | "favorability" | "funds";

function dbField(metric: Metric): string {
  if (metric === "influence") return "politicalInfluence";
  if (metric === "favorability") return "favorability";
  return "funds";
}

// GET /api/v1/leaderboard — Returns the top politicians ranked by influence, favorability, or funds; supports country and player-only filters.
// Auth: public
// Errors: (none)
export async function GET(request: Request) {
  try {
    const url = new URL(request.url);

    // Parse + validate params
    const metricParam = url.searchParams.get("metric") ?? "influence";
    const metric: Metric = ["influence", "favorability", "funds"].includes(metricParam)
      ? (metricParam as Metric)
      : "influence";

    const limitParam = parseInt(url.searchParams.get("limit") ?? "10", 10);
    const limit = Math.min(Math.max(isNaN(limitParam) ? 10 : limitParam, 1), 50);

    const authUser = await getAuthUser();
    const isAdmin = authUser?.isAdmin === true;
    const enabledCountries = isAdmin ? undefined : await getEnabledCountryIds();

    const countryParam = url.searchParams.get("country")?.toUpperCase();
    const countryId =
      countryParam && countryParam in COUNTRY_CONFIGS
        ? (countryParam as CountryId)
        : COUNTRY_CONFIGS.US.id;

    // This leaderboard is country-scoped, so every entry shares one currency.
    // Expose its code so clients format the `funds` value with the right symbol.
    const nativeCurrencyCode = COUNTRY_CURRENCY_MAP[countryId] ?? "USD";

    // For non-admins, return empty results if the requested country is disabled
    if (enabledCountries && !enabledCountries.includes(countryId)) {
      return NextResponse.json(
        { metric, country: countryId, nativeCurrencyCode, playersOnly: false, limit, entries: [] },
        {
          headers: {
            "Cache-Control": "public, s-maxage=60, stale-while-revalidate=120, no-transform",
          },
        }
      );
    }

    const playersOnly = url.searchParams.get("playersOnly") === "true";

    const sortField = dbField(metric);
    // Playtest characters are excluded here rather than filtered out downstream,
    // so they cannot occupy a rank and push a real player off the board. A
    // harness account outscoring people would be a bug report, not a standing.
    const countryFilter = { countryId, isSynthetic: { $ne: true } };

    const db = await getDb();

    // Fetch player characters (exclude banned users)
    const characters = await db
      .collection<Character>("characters")
      .aggregate<Character & { _userDoc?: { isBanned?: boolean } }>([
        { $match: countryFilter },
        {
          $lookup: {
            from: "users",
            // Typed equality join (userId and users._id are both ObjectIds) so
            // the _id index is used. The previous $expr compared $toString(_id)
            // to the raw ObjectId, which never matched and skipped the index.
            localField: "userId",
            foreignField: "_id",
            pipeline: [{ $project: { isBanned: 1 } }],
            as: "_user",
          },
        },
        { $addFields: { _userDoc: { $arrayElemAt: ["$_user", 0] } } },
        { $match: { $or: [{ "_userDoc.isBanned": { $ne: true } }, { _userDoc: null }] } },
        // funds is irrelevant for NPPs; only sort player characters by it
        { $sort: { [sortField]: -1, name: 1 } },
        { $project: { _user: 0, _userDoc: 0 } },
        ...(playersOnly ? [{ $limit: limit }] : []),
      ])
      .toArray();

    // Fetch NPPs unless playersOnly
    const npps = playersOnly
      ? []
      : await db
          .collection<NPP>("npps")
          .find({ retiredAt: null, ...countryFilter })
          .sort({ [sortField]: -1, name: 1 })
          .toArray();

    // Merge and sort
    type Entry = {
      id: string;
      sequentialId?: number;
      name: string;
      party: string;
      homeState: string;
      currentOffice: string;
      avatarUrl: string | undefined;
      value: number;
      isNPP: boolean;
    };

    const playerEntries: Entry[] = characters.map((c) => ({
      id: c._id.toString(),
      sequentialId: c.sequentialId,
      name: c.name,
      party: c.party,
      homeState: c.homeState,
      currentOffice: getOfficeLabel(c.currentOffice),
      avatarUrl: c.avatarUrl ?? undefined,
      value:
        metric === "influence"
          ? (c.politicalInfluence ?? 0)
          : metric === "favorability"
            ? (c.favorability ?? 50)
            : // LOCAL home-currency balance. Note: this leaderboard mixes
              // currencies if no `country` filter is applied — separate concern
              // (cross-currency leaderboard ranking) tracked outside cf-inconsistency-fix.
              (c.currencyBalances?.campaign ?? c.funds ?? 0),
      isNPP: false,
    }));

    const nppEntries: Entry[] = (metric !== "funds" ? npps : []).map((n: NPP) => ({
      id: n._id.toString(),
      name: n.name,
      party: n.party,
      homeState: n.homeState,
      currentOffice: getOfficeLabel(n.currentOffice),
      avatarUrl: n.avatarUrl ?? undefined,
      value: metric === "influence" ? (n.politicalInfluence ?? 0) : (n.favorability ?? 50),
      isNPP: true,
    }));

    const combined = [...playerEntries, ...nppEntries]
      .sort((a, b) => b.value - a.value)
      .slice(0, limit);

    // Resolve party names/colors and state names in bulk
    const partyIds = [...new Set(combined.map((e) => e.party).filter(Boolean))];
    const stateIds = [...new Set(combined.map((e) => e.homeState).filter(Boolean))];

    // Resolve parties by (sequentialId, countryId) — leaderboard is country-scoped
    // so a single countryId covers every entry in this response.
    const partySeqIds = partyIds.map((id) => Number(id)).filter((n) => Number.isFinite(n));

    const [partyDocs, stateDocs] = await Promise.all([
      db
        .collection<{ sequentialId: number; name: string; color?: string }>("politicalParties")
        .find(
          { sequentialId: { $in: partySeqIds }, countryId },
          { projection: { sequentialId: 1, name: 1, color: 1 } }
        )
        .toArray(),
      db
        .collection<{ _id: string; name: string }>("states")
        .find({ _id: { $in: stateIds } }, { projection: { name: 1 } })
        .toArray(),
    ]);

    type StateDoc = { _id: string; name: string };
    const partyMap = new Map(partyDocs.map((p) => [String(p.sequentialId), p]));
    const stateMap = new Map((stateDocs as StateDoc[]).map((s) => [s._id, s.name]));

    const entries = combined.map((e, i) => {
      const party = partyMap.get(e.party);
      return {
        rank: i + 1,
        id: e.id,
        sequentialId: e.sequentialId,
        name: e.name,
        party: e.party,
        partyName: party?.name ?? (e.party === "independent" ? "Independent" : e.party),
        partyColor: getPartyHex(e.party, party?.color),
        homeState: e.homeState,
        homeStateName: stateMap.get(e.homeState) ?? e.homeState,
        currentOffice: e.currentOffice,
        avatarUrl: e.avatarUrl ?? null,
        profileUrl: e.isNPP ? null : `${BASE_URL}/character/${e.sequentialId ?? e.id}`,
        value: e.value,
        isNPP: e.isNPP,
      };
    });

    return NextResponse.json(
      {
        metric,
        country: countryId,
        nativeCurrencyCode,
        playersOnly,
        limit,
        entries,
      },
      {
        headers: {
          "Cache-Control": "public, s-maxage=60, stale-while-revalidate=120, no-transform",
        },
      }
    );
  } catch (error) {
    return handleRouteError(error);
  }
}
