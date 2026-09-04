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
import { COUNTRY_CONFIGS, COUNTRY_ORDER, type CountryId } from "@/lib/constants/countries";
import {
  fxRateForSectorHostFromMap,
  loadFxRatesByCurrency,
  resolveSectorHostCurrencyCode,
  type CorpCapitalCurrencyInfo,
} from "@/lib/currency/corporationCapital";
import { readCorpEconomicAnchor } from "@/lib/currency/corpEconomyFields";
import { loadCommandEconomyBlockedCountries } from "@/lib/economy/queries/commandEconomyMarketGate";
import { loadCountryNameOverrides } from "@/lib/country/countryIdentity";

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
    const nameOverrides = await loadCountryNameOverrides(db);
    const countriesWithStates = new Set(states.map((s) => s.countryId));
    const countryNameOf = (id: CountryId): string =>
      nameOverrides[id] ?? COUNTRY_CONFIGS[id]?.name ?? id;

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

    const rows: SectorRow[] = [];

    if (view === "unowned") {
      // Query persisted unowned sectors
      const unownedFilter: Record<string, unknown> = {};
      if (sectorTypeFilter && CORPORATION_TYPES.includes(sectorTypeFilter)) {
        unownedFilter.sectorType = sectorTypeFilter;
      }
      if (countryFilter && countryFilter in COUNTRY_CONFIGS) {
        unownedFilter.countryId = countryFilter;
      }

      const unownedSectors = (
        await db
          .collection<UnownedSector>("unownedSectors")
          .find(unownedFilter, {
            projection: { sectorType: 1, stateId: 1, countryId: 1, revenue: 1 },
          })
          .toArray()
      ).filter((u) => !commandEconomyBlockedCountries.has(u.countryId));

      for (const us of unownedSectors) {
        const st = stateMap.get(us.stateId);
        const cfg = COUNTRY_CONFIGS[us.countryId];
        rows.push({
          id: us._id.toString(),
          sectorType: us.sectorType,
          sectorTypeLabel: CORPORATION_TYPE_LABELS[us.sectorType],
          stateId: us.stateId,
          stateName: st?.name ?? us.stateId,
          countryId: us.countryId,
          countryName: countryNameOf(us.countryId),
          countryFlag: cfg?.flagEmoji ?? "",
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
      if (countryFilter && countryFilter in COUNTRY_CONFIGS) {
        corpFilter.countryId = countryFilter;
      }
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
        const hostCountryId = (s.countryId ?? st?.countryId ?? corp?.countryId) as CountryId;
        const revenueAnchor = readCorpEconomicAnchor(
          s.revenue,
          resolveSectorHostCurrencyCode({ countryId: hostCountryId }, corp),
          fxRateForSectorHostFromMap({ countryId: hostCountryId }, corp, fxByCurrency)
        );
        const cfg = COUNTRY_CONFIGS[hostCountryId];

        rows.push({
          id: s._id.toString(),
          sectorType: s.sectorType,
          sectorTypeLabel: CORPORATION_TYPE_LABELS[s.sectorType],
          stateId: s.stateId,
          stateName: st?.name ?? s.stateId,
          countryId: hostCountryId,
          countryName: countryNameOf(hostCountryId),
          countryFlag: cfg?.flagEmoji ?? "",
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
    const unownedCountFilter: Record<string, unknown> = {};
    if (countryFilter) {
      unownedCountFilter.countryId = commandEconomyBlockedCountries.has(countryFilter)
        ? { $in: [] }
        : countryFilter;
    } else if (commandEconomyBlockedCountries.size > 0) {
      unownedCountFilter.countryId = { $nin: [...commandEconomyBlockedCountries] };
    }

    const [unownedCount, ownedCount, forSaleCount] = await Promise.all([
      db.collection("unownedSectors").countDocuments(unownedCountFilter),
      db
        .collection("corporateSectors")
        .countDocuments(countryFilter ? { countryId: countryFilter } : {}),
      db.collection("corporateSectors").countDocuments({
        forSale: { $ne: null },
        ...(countryFilter ? { countryId: countryFilter } : {}),
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
          flag: COUNTRY_CONFIGS[id].flagEmoji,
        })),
      },
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
