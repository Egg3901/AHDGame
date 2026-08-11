import { NextResponse } from "next/server";
import { unstable_cache } from "next/cache";
import { handleRouteError } from "@/lib/api/errors";
import { getDb } from "@/lib/mongodb";
import type { LegislationType } from "@/lib/db/types";
import { BILL_CATEGORIES, CATEGORY_TO_POLICY_DOMAINS } from "@shared/constants/legislation";
import { LEGISLATION_TYPES_CACHE_TAG } from "@/lib/legislation/cacheTag";
import { getEraContext } from "@/lib/era/context";
import { isLegislationTypeActive, isNewThisEra } from "@/lib/era/legislationCatalog";
import { attachPoliticalLegislationEstimates } from "@/lib/politicalLegislation/estimates";

// Legislation types are near-static — written only by admin seed / law-type
// edit routes, never by gameplay or turn processing. We cache the read with a
// short TTL so player-facing reads stop hitting the DB; the admin editor passes
// `nocache=1` (see below) so an admin always sees their own edits immediately,
// and the few-minute TTL bounds how long other clients see a stale list.
async function fetchLegislationTypes(
  category: string | undefined,
  scope: string | undefined,
  country: string | undefined,
  minimal: boolean
): Promise<Record<string, unknown>[]> {
  const db = await getDb();
  const query: Record<string, unknown> = {};
  if (category && BILL_CATEGORIES.includes(category as (typeof BILL_CATEGORIES)[number])) {
    const domains = CATEGORY_TO_POLICY_DOMAINS[category as (typeof BILL_CATEGORIES)[number]];
    if (domains?.length) query.policyDomain = { $in: domains };
  }

  // Filter by country scope - only show legislation types for the specified country.
  // Any country scopes to its own `countryScope`; US (and a blank/unknown country)
  // additionally catches legacy types with no countryScope. Previously a hardcoded
  // allowlist meant seeded countries missing from it (NG, and others) fell through
  // with NO country filter, leaking every country's laws into the picker (#912).
  if (country && country !== "us") {
    query.countryScope = country;
  } else {
    // US, or no country specified: US-scoped + legacy no-scope types.
    query.$or = [{ countryScope: "us" }, { countryScope: { $exists: false } }];
  }

  // Filter by scope if provided
  if (scope === "state") {
    // Include types that allow state scope (allowedScope: "state" or "both", or nationalOnly: false/undefined)
    const scopeConditions = [
      { allowedScope: "state" },
      { allowedScope: "both" },
      { allowedScope: { $exists: false }, nationalOnly: { $ne: true } },
    ];
    // Merge with existing $or if present (from country filter)
    if (query.$or) {
      const countryOr = query.$or as Record<string, unknown>[];
      delete query.$or;
      query.$and = [{ $or: countryOr }, { $or: scopeConditions }];
    } else {
      query.$or = scopeConditions;
    }
  } else if (scope === "national") {
    // Include types that allow national scope
    const scopeConditions = [
      { allowedScope: "national" },
      { allowedScope: "both" },
      { allowedScope: { $exists: false } },
    ];
    // Merge with existing $or if present (from country filter)
    if (query.$or) {
      const countryOr = query.$or as Record<string, unknown>[];
      delete query.$or;
      query.$and = [{ $or: countryOr }, { $or: scopeConditions }];
    } else {
      query.$or = scopeConditions;
    }
  }

  const cursor = db
    .collection<LegislationType>("legislationTypes")
    .find(query)
    .sort({ policyDomain: 1, subCategory: 1 });
  return minimal
    ? await cursor.project({ _id: 1, name: 1, policyDomain: 1, positions: 1 }).toArray()
    : await cursor.toArray();
}

function getCachedLegislationTypes(
  category: string | undefined,
  scope: string | undefined,
  country: string | undefined,
  minimal: boolean
): Promise<Record<string, unknown>[]> {
  return unstable_cache(
    () => fetchLegislationTypes(category, scope, country, minimal),
    ["legislation-types", category ?? "", scope ?? "", country ?? "", minimal ? "minimal" : "full"],
    { revalidate: 300, tags: [LEGISLATION_TYPES_CACHE_TAG] }
  )();
}

// GET /api/game/legislation-types — Returns legislation types filtered by category, scope, and country.
// Auth: public
// Errors: (none)
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const category = searchParams.get("category")?.toLowerCase().trim();
    const scope = searchParams.get("scope")?.toLowerCase().trim(); // "state" or "national"
    const country = searchParams.get("country")?.toLowerCase().trim(); // "us" or "uk"
    const minimal = searchParams.get("minimal") === "1";
    const noCache = searchParams.get("nocache") === "1";

    // `nocache=1` (used by the admin editor) bypasses the read cache entirely so
    // edits are visible immediately even before tag revalidation propagates.
    const types = noCache
      ? await fetchLegislationTypes(category, scope, country, minimal)
      : await getCachedLegislationTypes(category, scope, country, minimal);

    // Era gate — MUST run OUTSIDE the cached fetch: getCachedLegislationTypes is
    // keyed by (category, scope, country, minimal), NOT year, so filtering inside
    // it would freeze one era's list across worlds. Null year (flag off) ⇒ no
    // change, byte-identical legacy.
    const db = await getDb();
    const { year: eraYear, incomeBandIndexByCountry } = await getEraContext(db);
    const gated =
      eraYear == null
        ? types
        : types
            .filter((t) => isLegislationTypeActive(String(t._id), eraYear))
            .map((t) => ({ ...t, eraNew: isNewThisEra(String(t._id), eraYear) }));

    // Political-legislation v2 (spec §8): attach live fiscal estimates for
    // new-generation types. MUST run OUTSIDE the cached fetch — estimates
    // depend on live GDP/population/taxRates. `regionId` prices at regional
    // scope for regional proposals; otherwise the national rollup.
    const withEstimates = await attachPoliticalLegislationEstimates(
      db,
      gated,
      country,
      searchParams.get("regionId"),
      incomeBandIndexByCountry
    );

    return NextResponse.json(withEstimates, {
      headers: {
        "Cache-Control": noCache
          ? "no-store, no-cache, must-revalidate, no-transform"
          : // Era gate is world-state-dependent; keep it private + short-lived
            // when the flag is on so a shared cache never serves one era's list
            // to another. Flag off keeps the original public caching.
            eraYear == null
            ? "public, max-age=3600, stale-while-revalidate=86400, no-transform"
            : "private, max-age=30, no-transform",
      },
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
