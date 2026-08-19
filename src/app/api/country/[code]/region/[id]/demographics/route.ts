import { NextResponse } from "next/server";
import { handleRouteError } from "@/lib/api/errors";
import { getDb } from "@/lib/mongodb";
import { loadDemographicCategories } from "@/lib/demographics/categoryCatalog";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import type { DemographicCategory, StateDemographics, State } from "@/lib/db/types";
import { calculateStateLean } from "@/lib/utils/demographics";
import { REGION_DEMOGRAPHIC_CATEGORY_IDS } from "@/app/country/[code]/region/[id]/regionData";

interface RouteParams {
  params: Promise<{ code: string; id: string }>;
}

// GET /api/country/[code]/region/[id]/demographics — Return demographic group data and political lean for a region
// Auth: public
// Errors: 400, 404
export async function GET(_request: Request, { params }: RouteParams) {
  try {
    const { code, id } = await params;
    const countryId = code.toUpperCase() as CountryId;
    if (!COUNTRY_CONFIGS[countryId]) {
      return NextResponse.json({ error: "Invalid country code" }, { status: 400 });
    }
    const stateId = id;

    const db = await getDb();

    // Verify state exists
    const state = await db.collection<State>("states").findOne({ _id: stateId, countryId });
    if (!state) {
      return NextResponse.json({ error: "State not found" }, { status: 404 });
    }

    const demographics = await db
      .collection<StateDemographics>("stateDemographics")
      .findOne({ _id: stateId });

    if (!demographics) {
      return NextResponse.json({ error: "Demographics not found for this state" }, { status: 404 });
    }

    const categoryFilter = REGION_DEMOGRAPHIC_CATEGORY_IDS[countryId];
    const categories = categoryFilter
      ? await db
          .collection<DemographicCategory>("demographicCategories")
          .find({ _id: { $in: categoryFilter } })
          .toArray()
      : await loadDemographicCategories(db);

    const calculatedLean =
      state.cachedEconomicLean != null && state.cachedSocialLean != null
        ? {
            economicLean: state.cachedEconomicLean,
            socialLean: state.cachedSocialLean,
          }
        : calculateStateLean(demographics, categories);

    // Return public data (exclude category weights - admin only)
    return NextResponse.json({
      stateId,
      stateName: state.name,
      groups: demographics.groups,
      calculatedEconomicLean: calculatedLean.economicLean,
      calculatedSocialLean: calculatedLean.socialLean,
      categories: categories.map((c) => ({
        id: c._id,
        name: c.name,
        groups: c.groups.map((g) => ({ id: g.id, name: g.name, defaultTurnout: g.defaultTurnout })),
      })),
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
