/**
 * GET /api/unions/leaderboard: player-run unions (vacant or led), ranked by
 * real membership then treasury (union dues v1). Read-only, no auth required
 * (mirrors other public leaderboards). Gated on `labourSystemMode >= "full"`
 * (code-review fix #10/#13).
 *
 * `?country=XX` scopes the list to one country (the page defaults it to the
 * viewer's country). `availableCountries` is always returned so the page can
 * render its country switcher. No param → all countries (fallback).
 */
import { NextResponse, type NextRequest } from "next/server";
import { getDb } from "@/lib/mongodb";
import { handleRouteError } from "@/lib/api/errors";
import type { CorporateSector, FederalBudget, Union } from "@/lib/db/types";
import { CORPORATION_TYPE_LABELS } from "@/lib/constants/corporations";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { isLabourFullMode } from "@/lib/labour/featureFlag";
import { genericUnionName } from "@/lib/unions/unionNames";
import { resolveUnionOwners } from "@/lib/unions/unionOwnerDisplay";
import { unionApproval, unionMembers } from "@/lib/unions/unionDues";

export async function GET(req: NextRequest) {
  try {
    if (!(await isLabourFullMode())) {
      return NextResponse.json({ error: "Player-run unions are not enabled." }, { status: 403 });
    }

    const db = await getDb();
    // Country ids are upper-case everywhere in the data ("UK"), but callers
    // reach this route with whatever case their URL segment carried, the
    // /country/[code]/unions page passes a lower-cased code. An unmatched
    // param falls through to "no filter", so a lower-case code silently
    // returned every union in the world instead of that country's.
    const countryParam = req.nextUrl.searchParams.get("country")?.toUpperCase() ?? null;

    // Countries that actually have unions, the switcher's options.
    const availableCountries = (await db.collection<Union>("unions").distinct("countryId"))
      .map((cid) => ({ countryId: cid, countryName: COUNTRY_CONFIGS[cid]?.name ?? cid }))
      .sort((a, b) => a.countryName.localeCompare(b.countryName));

    // Union ban (player suggestion #93): countries with an enacted ban, so
    // the /unions page can render its banned-state banner and mark suspended
    // rows. federalBudget is small (one doc per country), a full scan with a
    // tight projection is cheap.
    const bannedBudgets = await db
      .collection<FederalBudget>("federalBudget")
      .find({ unionsBanned: true }, { projection: { countryId: 1 } })
      .toArray();
    const bannedCountryIds = new Set(
      bannedBudgets.map((b) => b.countryId).filter((c): c is NonNullable<typeof c> => !!c)
    );
    const bannedCountries = [...bannedCountryIds].map((countryId) => ({
      countryId,
      // FederalBudget.countryId is a plain string, the safe cast mirrors
      // how COUNTRY_CONFIGS lookups handle it elsewhere (fallback = raw id).
      countryName: COUNTRY_CONFIGS[countryId as keyof typeof COUNTRY_CONFIGS]?.name ?? countryId,
    }));

    const countryFilter =
      countryParam && countryParam in COUNTRY_CONFIGS
        ? { countryId: countryParam as CountryId }
        : {};
    // Sort is applied in JS below, once `members` (real headcount) is known, 
    // it isn't a stored field, it's derived from represented sectors.
    const unions = await db.collection<Union>("unions").find(countryFilter).toArray();

    // NPP-run unions store `ownerId` against `npps`, not `characters`. Looking
    // only at characters left every NPP presidency labelled "Unknown".
    const [ownersById, memberSectors] = await Promise.all([
      resolveUnionOwners(db, unions),
      unions.length
        ? db
            .collection<CorporateSector>("corporateSectors")
            .find(
              { representingUnionId: { $in: unions.map((u) => u._id) } },
              { projection: { representingUnionId: 1, workers: 1, unionization: 1 } }
            )
            .toArray()
        : Promise.resolve([]),
    ]);
    const sectorsByUnionId = new Map<string, CorporateSector[]>();
    for (const sector of memberSectors) {
      if (!sector.representingUnionId) continue;
      const key = sector.representingUnionId.toString();
      const group = sectorsByUnionId.get(key) ?? [];
      group.push(sector);
      sectorsByUnionId.set(key, group);
    }

    const rows = unions
      .map((u) => {
        const members = unionMembers(sectorsByUnionId.get(u._id.toString()) ?? []);
        return {
          unionId: u._id.toString(),
          name: u.name ?? genericUnionName(u.countryId, u.sectorType),
          countryId: u.countryId,
          countryName: COUNTRY_CONFIGS[u.countryId]?.name ?? u.countryId,
          sectorType: u.sectorType,
          sectorLabel: CORPORATION_TYPE_LABELS[u.sectorType] ?? u.sectorType,
          leaderName: u.ownerId ? (ownersById.get(u.ownerId.toString())?.name ?? "Unknown") : null,
          isVacant: u.ownerId == null,
          members,
          approval: unionApproval(u),
          treasury: u.treasury,
          demandedWageLevel: u.demandedWageLevel,
          // A union seeded while a ban is already active carries no suspended
          // flag (the enactment updateMany only touched docs existing at ban
          // time), the budget flag is authoritative, so derive the badge from
          // either source.
          suspended: u.suspended === true || bannedCountryIds.has(u.countryId),
        };
      })
      .sort((a, b) => b.members - a.members || b.treasury - a.treasury || a.name.localeCompare(b.name));

    return NextResponse.json({ unions: rows, bannedCountries, availableCountries });
  } catch (error) {
    return handleRouteError(error);
  }
}
