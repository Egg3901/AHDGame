/**
 * Debug endpoint for demographic lean calculation.
 * GET /api/debug/demographics?state=CA
 *
 * Returns raw data and calculation steps to diagnose why leans show as Center.
 * Only available to admins or when NODE_ENV !== "production".
 */

import { NextResponse } from "next/server";
import { handleRouteError } from "@/lib/api/errors";
import { getDb } from "@/lib/mongodb";
import { requireAdmin } from "@/lib/api/requireAdmin";
import type { StateDemographics, DemographicCategory, State } from "@/lib/db/types";
import type { CountryId } from "@/lib/constants/countries";
import { calculateStateLean, getStateLean } from "@/lib/utils/demographics";

// GET /api/debug/demographics — Debug demographic lean calculation for a given state; admin-only in production.
// Auth: requireAdmin
// Errors: 403
export async function GET(request: Request) {
  // Restrict to admins in production; allow unauthenticated in dev
  if (process.env.NODE_ENV === "production") {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;
  }

  const { searchParams } = new URL(request.url);
  const stateId = (searchParams.get("state") || "CA").toUpperCase();
  // Debug route — defaults to US when ?country is omitted (matches the legacy
  // CA default state). Scoping by country prevents cross-country state-ID
  // collisions (CN HB / DE HB) from resolving to the wrong state.
  const countryId = (searchParams.get("country") || "US").toUpperCase() as CountryId;

  try {
    const db = await getDb();

    const [demographics, categories, state] = await Promise.all([
      db.collection<StateDemographics>("stateDemographics").findOne({ _id: stateId, countryId }),
      db.collection<DemographicCategory>("demographicCategories").find({}).toArray(),
      db.collection<State>("states").findOne({ _id: stateId, countryId }),
    ]);

    const debug: Record<string, unknown> = {
      stateId,
      hasDemographics: !!demographics,
      categoriesCount: categories.length,
      hasState: !!state,
      statePoliticalLean: state ? getStateLean(state) : null,
      stateCachedLeans: (state as { cachedEconomicLean?: number; cachedSocialLean?: number })
        ? {
            economic: (state as { cachedEconomicLean?: number }).cachedEconomicLean,
            social: (state as { cachedSocialLean?: number }).cachedSocialLean,
          }
        : null,
    };

    if (!demographics) {
      return NextResponse.json({
        ...debug,
        error: "No demographics found for this state",
        calculatedLeans: null,
      });
    }

    if (categories.length === 0) {
      return NextResponse.json({
        ...debug,
        error: "No demographic categories in DB (run seed:demographics)",
        calculatedLeans: null,
      });
    }

    // Run calculation and capture per-category breakdown
    const categoryBreakdown: Array<{
      id: string;
      weight: number;
      popSum: number;
      categoryEconomic: number;
      categorySocial: number;
      groupsFound: number;
      groupsTotal: number;
    }> = [];

    const categoryWeights = demographics.categoryWeights;
    const groups = demographics.groups;

    let totalEconomicLean = 0;
    let totalSocialLean = 0;

    for (const category of categories) {
      // Only count categories this region explicitly weights — no
      // `defaultWeight` fallback — so the debug breakdown matches
      // `calculateStateLean` / `computeMedianVoter` (which the vote engine
      // uses). A category absent from `categoryWeights` contributes 0.
      const rawCatWeight = categoryWeights?.[category._id as keyof typeof categoryWeights];
      const effectiveWeight = rawCatWeight != null ? Number(rawCatWeight) : 0;

      let categoryEconomic = 0;
      let categorySocial = 0;
      let categoryPopSum = 0;
      let groupsFound = 0;

      for (const group of category.groups) {
        const stateGroup = groups?.[group.id];
        if (!stateGroup) continue;
        groupsFound++;

        const pop = Number(stateGroup.population) || 0;
        categoryPopSum += pop;

        const economicLean =
          typeof stateGroup.economicLean === "number"
            ? stateGroup.economicLean
            : (group.defaultEconomicLean ?? 0);
        const socialLean =
          typeof stateGroup.socialLean === "number"
            ? stateGroup.socialLean
            : (group.defaultSocialLean ?? 0);

        categoryEconomic += pop * economicLean;
        categorySocial += pop * socialLean;
      }

      if (categoryPopSum > 0) {
        categoryEconomic /= categoryPopSum;
        categorySocial /= categoryPopSum;
      }

      totalEconomicLean += (effectiveWeight / 100) * categoryEconomic;
      totalSocialLean += (effectiveWeight / 100) * categorySocial;

      categoryBreakdown.push({
        id: category._id,
        weight: effectiveWeight,
        popSum: categoryPopSum,
        categoryEconomic: Math.round(categoryEconomic * 100) / 100,
        categorySocial: Math.round(categorySocial * 100) / 100,
        groupsFound,
        groupsTotal: category.groups.length,
      });
    }

    const calculatedLeans = {
      economicLean: Math.round(totalEconomicLean * 100) / 100,
      socialLean: Math.round(totalSocialLean * 100) / 100,
    };

    // Verify against actual function
    const actualResult = calculateStateLean(demographics, categories);

    return NextResponse.json({
      ...debug,
      categoryBreakdown,
      calculatedLeans,
      actualCalculateStateLeanResult: actualResult,
      sampleGroupKeys: demographics.groups ? Object.keys(demographics.groups).slice(0, 10) : [],
      sampleCategoryIds: categories.map((c) => c._id),
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
