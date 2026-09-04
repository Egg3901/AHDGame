import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { handleRouteError } from "@/lib/api/errors";
import type { CorporateSector, State, UnownedSector, Corporation } from "@/lib/db/types";
import {
  CORPORATION_TYPES,
  CORPORATION_TYPE_LABELS,
  type CorporationType,
} from "@/lib/constants/corporations";
import {
  COUNTRY_CONFIGS,
  COUNTRY_ORDER,
  getCountryDisplayName,
  type CountryId,
} from "@/lib/constants/countries";
import {
  fxRateForSectorHostFromMap,
  loadFxRatesByCurrency,
  resolveSectorHostCurrencyCode,
  type CorpCapitalCurrencyInfo,
} from "@/lib/currency/corporationCapital";
import { readCorpEconomicAnchor } from "@/lib/currency/corpEconomyFields";
import { loadCommandEconomyBlockedCountries } from "@/lib/economy/queries/commandEconomyMarketGate";
import { loadCountryPresentationOverrides } from "@/lib/country/countryIdentity";
import { loadWorldPreset } from "@/lib/currency/gdpAnchorRate";

export type SectorView = "unowned" | "owned" | "forSale";
export type SectorSort = "revenue" | "type" | "state" | "country" | "margin" | "growth";

type SectorRow = {
  id: string;
  sectorType: CorporationType;
  sectorTypeLabel: string;
  stateId: string;
  stateName: string;
  countryId: CountryId;
  countryName: string;
  countryFlag: string;
  owned: boolean;
  corporationId: string | null;
  corporationName: string | null;
  corporationSequentialId: number | null;
  corporationLogoUrl: string | null;
  revenue: number;
  revenueAnchor: number;
  margin: number | null;
  growthRate: number | null;
  workers: number | null;
  forSale: boolean;
  forSalePrice: number | null;
};

const PAGE_SIZE = 50;

// GET /api/sectors — Global sector listing with filters
// Query params:
//   view=unowned|owned|forSale (default: unowned)
//   type=<CorporationType> (optional filter)
//   country=<CountryId> (optional filter)
//   sort=revenue|type|state|country|margin|growth (default: revenue)
//   dir=asc|desc (default: desc)
//   page=1
export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const sp = url.searchParams;

    const view: SectorView =
      sp.get("view") === "owned" ? "owned" : sp.get("view") === "forSale" ? "forSale" : "unowned";

    const sectorTypeFilter = sp.get("type") as CorporationType | null;
    const countryFilter = sp.get("country") as CountryId | null;
    const sort: SectorSort = (sp.get("sort") as SectorSort) ?? "revenue";
    const dir = sp.get("dir") === "asc" ? "asc" : "desc";
    const page = Math.max(1, parseInt(sp.get("page") ?? "1", 10));

    const db = await getDb();

    // Load states for name resolution
    const states = await db
      .collection<State>("states")
      .find({})
      .project<{ _id: string; name: string; countryId: CountryId }>({
        _id: 1,
        name: 1,
        countryId: 1,
      })
      .toArray();
    const stateMap = new Map(states.map((s) => [s._id, s]));

    // A country that renamed itself must be listed and labelled under the name
    // it goes by. Reunified Germany keeps `DD` as its country id and carries the
    // new name in `countryState.displayNameOverride`, so reading the compiled
    // config alone showed its sectors under "East Germany" while the dissolved
    // shell still offered "Germany" as a filter that could never match a row
    // (ticket #1271). `COUNTRY_ORDER` is the compiled roster, so it is narrowed
    // to countries that still hold territory rather than trusted as a list of
    // live countries.
    //
    // Three corrections, not one. The runtime override is what reunification
    // writes; the ERA name is what a 1953 world calls RU ("Soviet Union") and DE
    // ("West Germany"); and the flag override travels with the rename, so
    // applying only the name left Germany labelled correctly under the flag of
    // the state it replaced.
    //
    // `loadCountryPresentationOverrides` rather than `resolveCountryIdentities`
    // because the latter reads through `getCountryState`, which SELF-HEALS a
    // missing row. This is a public listing endpoint and must not be able to
    // insert documents as a side effect of someone sorting a table.
    const [preset, overrides] = await Promise.all([
      loadWorldPreset(db),
      loadCountryPresentationOverrides(db),
    ]);
    const countriesWithStates = new Set(states.map((s) => s.countryId));

    // WHICH COUNTRY A SECTOR IS IN IS DECIDED BY ITS STATE, in one place, and the
    // row labels, the country filter and the tab badges all use it. They have to
    // agree: labelling a row from its state while filtering on its stored
    // `countryId` means a row whose stored value went stale when its region
    // changed hands is shown under one country and findable under another, or
    // under none at all once the filter list is narrowed to countries that hold
    // territory. Expressing the filter as `stateId in (that country's states)`
    // IS the state-first rule, and it stays a database query.
    const stateIdsByCountry = new Map<CountryId, string[]>();
    for (const s of states) {
      const list = stateIdsByCountry.get(s.countryId);
      if (list) list.push(s._id);
      else stateIdsByCountry.set(s.countryId, [s._id]);
    }
    const filteredStateIds =
      countryFilter && countryFilter in COUNTRY_CONFIGS
        ? (stateIdsByCountry.get(countryFilter) ?? [])
        : null;
    /** The country a row is in: its state's, then whatever it stored. */
    const hostCountryOf = (
      stateId: string,
      ...fallbacks: (string | null | undefined)[]
    ): CountryId => (stateMap.get(stateId)?.countryId ?? fallbacks.find(Boolean)) as CountryId;

    /**
     * The country filter, as a query. Used by the rows AND by the badge counts,
     * so the two cannot disagree.
     *
     * The second leg is for a row whose state no longer exists: `mergeRegion`
     * re-points sector rows before deleting a region, so this is debris rather
     * than normal state, and the pool heal deliberately leaves it for a human.
     * It is still LABELLED from its stored country, and without this leg it
     * would be labelled under a country whose filter could never return it:
     * visible in the unfiltered list, gone the moment you filter by the country
     * it names. Findable under the name it is shown under is the only pairing
     * that is not a lie.
     */
    const allStateIds = states.map((st) => st._id);
    const countryScopedFilter: Record<string, unknown> = filteredStateIds
      ? {
          $or: [
            { stateId: { $in: filteredStateIds } },
            { stateId: { $nin: allStateIds }, countryId: countryFilter },
          ],
        }
      : {};
    const countryNameOf = (id: CountryId): string =>
      overrides[id]?.name ?? getCountryDisplayName(id, preset);
    const countryFlagOf = (id: CountryId): string =>
      overrides[id]?.flagEmoji ?? COUNTRY_CONFIGS[id]?.flagEmoji ?? "";

    // Load FX rates for anchor normalization
    const fxByCurrency = await loadFxRatesByCurrency(db);

    // Command economies (USSR, East Germany, etc) run production through the
    // state — an "unowned" market there isn't a private-capture opportunity.
    // Computed once for the whole request; only the "unowned" view (and its
    // count badge) consult it — owned/forSale sectors may legitimately be
    // held by a National Corporation (SOE) in these countries.
    const commandEconomyBlockedCountries = await loadCommandEconomyBlockedCountries(
      db,
      COUNTRY_ORDER
    );
    const blockedStateIds = states
      .filter((s) => commandEconomyBlockedCountries.has(s.countryId))
      .map((s) => s._id);

    const rows: SectorRow[] = [];

    if (view === "unowned") {
      // Query persisted unowned sectors
      const unownedFilter: Record<string, unknown> = {};
      if (sectorTypeFilter && CORPORATION_TYPES.includes(sectorTypeFilter)) {
        unownedFilter.sectorType = sectorTypeFilter;
      }
      Object.assign(unownedFilter, countryScopedFilter);

      const unownedSectors = (
        await db
          .collection<UnownedSector>("unownedSectors")
          .find(unownedFilter, {
            projection: { sectorType: 1, stateId: 1, countryId: 1, revenue: 1 },
          })
          .toArray()
      )
        // NO stored-country fallback in the BLOCK test, deliberately, even though
        // the row label below has one. The badge counts with
        // `stateId $nin <blocked states>`, which knows nothing about a stored
        // country, so falling back here would drop a row from the list that the
        // badge still counted: badge N+1, list N. A pool row on a dissolved
        // region belongs to no state and so is blocked by nobody, which is
        // exactly the answer the count gives.
        .filter(
          (u) =>
            !commandEconomyBlockedCountries.has(stateMap.get(u.stateId)?.countryId as CountryId)
        );

      for (const us of unownedSectors) {
        const st = stateMap.get(us.stateId);
        rows.push({
          id: us._id.toString(),
          sectorType: us.sectorType,
          sectorTypeLabel: CORPORATION_TYPE_LABELS[us.sectorType],
          stateId: us.stateId,
          stateName: st?.name ?? us.stateId,
          countryId: hostCountryOf(us.stateId, us.countryId),
          countryName: countryNameOf(hostCountryOf(us.stateId, us.countryId)),
          countryFlag: countryFlagOf(hostCountryOf(us.stateId, us.countryId)),
          owned: false,
          corporationId: null,
          corporationName: null,
          corporationSequentialId: null,
          corporationLogoUrl: null,
          revenue: Math.round(us.revenue),
          revenueAnchor: Math.round(us.revenue),
          margin: null,
          growthRate: null,
          workers: null,
          forSale: false,
          forSalePrice: null,
        });
      }
    } else {
      // Owned or forSale — query corporateSectors
      const corpFilter: Record<string, unknown> = {};
      if (sectorTypeFilter && CORPORATION_TYPES.includes(sectorTypeFilter)) {
        corpFilter.sectorType = sectorTypeFilter;
      }
      Object.assign(corpFilter, countryScopedFilter);
      if (view === "forSale") {
        corpFilter.forSale = { $ne: null };
      }

      const ownedSectors = await db
        .collection<CorporateSector>("corporateSectors")
        .find(corpFilter, {
          projection: {
            sectorType: 1,
            stateId: 1,
            countryId: 1,
            corporationId: 1,
            revenue: 1,
            profitMargin: 1,
            currentGrowthRate: 1,
            forSale: 1,
          },
        })
        .toArray();

      // Resolve corporations for name + currency
      const corpIds = [...new Set(ownedSectors.map((s) => s.corporationId.toString()))];
      const corpObjectIds = corpIds
        .filter((id) => ObjectId.isValid(id))
        .map((id) => new ObjectId(id));

      const corporations =
        corpObjectIds.length > 0
          ? await db
              .collection<Corporation>("corporations")
              .find({ _id: { $in: corpObjectIds } })
              .project<
                {
                  _id: ObjectId;
                  name: string;
                  sequentialId?: number;
                  logoUrl?: string;
                } & CorpCapitalCurrencyInfo
              >({
                _id: 1,
                name: 1,
                sequentialId: 1,
                logoUrl: 1,
                countryId: 1,
                liquidCurrencyCode: 1,
              })
              .toArray()
          : [];

      const corpMap = new Map(corporations.map((c) => [c._id.toString(), c]));

      for (const s of ownedSectors) {
        const st = stateMap.get(s.stateId);
        const corp = corpMap.get(s.corporationId.toString());
        // STATE FIRST, matching `getSectorOperatingCountryId`, which is the
        // codebase's answer to this question everywhere else (hostile takeover,
        // the duplicate-sector repair). A sector row whose stored `countryId` is
        // stale after its region changed hands would otherwise be labelled under
        // a country that no longer holds it, and after the filter narrowing above
        // that country is not even offered as an option to find it under.
        const hostCountryId = hostCountryOf(s.stateId, s.countryId, corp?.countryId);
        const revenueAnchor = readCorpEconomicAnchor(
          s.revenue,
          resolveSectorHostCurrencyCode({ countryId: hostCountryId }, corp),
          fxRateForSectorHostFromMap({ countryId: hostCountryId }, corp, fxByCurrency)
        );

        rows.push({
          id: s._id.toString(),
          sectorType: s.sectorType,
          sectorTypeLabel: CORPORATION_TYPE_LABELS[s.sectorType],
          stateId: s.stateId,
          stateName: st?.name ?? s.stateId,
          countryId: hostCountryId,
          countryName: countryNameOf(hostCountryId),
          countryFlag: countryFlagOf(hostCountryId),
          owned: true,
          corporationId: s.corporationId.toString(),
          corporationName: corp?.name ?? "Unknown",
          corporationSequentialId: corp?.sequentialId ?? null,
          corporationLogoUrl: corp?.logoUrl ?? null,
          revenue: Math.round(s.revenue),
          revenueAnchor: Math.round(revenueAnchor),
          margin: s.profitMargin ?? null,
          growthRate: s.currentGrowthRate ?? null,
          workers: null,
          forSale: !!s.forSale,
          forSalePrice: s.forSale?.priceAnchor ?? null,
        });
      }
    }

    // Sort
    const sign = dir === "asc" ? 1 : -1;
    rows.sort((a, b) => {
      switch (sort) {
        case "type":
          return a.sectorTypeLabel.localeCompare(b.sectorTypeLabel) * sign;
        case "state":
          return a.stateName.localeCompare(b.stateName) * sign;
        case "country":
          return a.countryName.localeCompare(b.countryName) * sign;
        case "margin":
          return ((a.margin ?? 0) - (b.margin ?? 0)) * sign;
        case "growth":
          return ((a.growthRate ?? 0) - (b.growthRate ?? 0)) * sign;
        case "revenue":
        default:
          return (a.revenueAnchor - b.revenueAnchor) * sign;
      }
    });

    // Paginate
    const totalItems = rows.length;
    const totalPages = Math.max(1, Math.ceil(totalItems / PAGE_SIZE));
    const clampedPage = Math.min(page, totalPages);
    const start = (clampedPage - 1) * PAGE_SIZE;
    const pageItems = rows.slice(start, start + PAGE_SIZE);

    // Summary counts for tab badges. The unowned count excludes command-economy
    // countries the same way the row query above does — an explicit country
    // filter that itself points at a blocked country correctly counts to 0
    // rather than falling back to the unfiltered total.
    //
    // Counted on the same state-first basis the rows and the filter use, so a
    // badge can never disagree with the list under it.
    const unownedCountFilter: Record<string, unknown> = filteredStateIds
      ? commandEconomyBlockedCountries.has(countryFilter as CountryId)
        ? { stateId: { $in: [] } }
        : { ...countryScopedFilter }
      : blockedStateIds.length > 0
        ? { stateId: { $nin: blockedStateIds } }
        : {};
    const corpCountFilter = { ...countryScopedFilter };

    const [unownedCount, ownedCount, forSaleCount] = await Promise.all([
      db.collection("unownedSectors").countDocuments(unownedCountFilter),
      db.collection("corporateSectors").countDocuments(corpCountFilter),
      db.collection("corporateSectors").countDocuments({
        forSale: { $ne: null },
        ...corpCountFilter,
      }),
    ]);

    return NextResponse.json({
      view,
      sort,
      dir,
      page: clampedPage,
      totalPages,
      totalItems,
      sectors: pageItems,
      counts: {
        unowned: unownedCount,
        owned: ownedCount,
        forSale: forSaleCount,
      },
      filters: {
        sectorTypes: CORPORATION_TYPES.map((t) => ({
          value: t,
          label: CORPORATION_TYPE_LABELS[t],
        })),
        // Curated order preserved: COUNTRY_ORDER is hand-ordered, not
        // alphabetical, so this filters and relabels without resequencing.
        countries: COUNTRY_ORDER.filter((id) => countriesWithStates.has(id)).map((id) => ({
          value: id,
          label: countryNameOf(id),
          flag: countryFlagOf(id),
        })),
      },
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
