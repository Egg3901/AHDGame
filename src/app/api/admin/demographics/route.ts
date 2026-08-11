import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import type { CountryId } from "@/lib/constants/countries";
import { requireAdmin } from "@/lib/api/requireAdmin";
import { handleRouteError } from "@/lib/api/errors";
import { parseJsonBody } from "@/lib/api/validate";
import { adminDemographicsPatchSchema, adminDemographicsPostSchema } from "@/lib/api/schemas/admin";
import type {
  CategoryWeights,
  DemographicCategory,
  StateDemographics,
  StateDemographicGroup,
  State,
  AdminLog,
  GameState,
} from "@/lib/db/types";
import { validateCategoryWeights } from "@/lib/utils/demographics";
import { calculateStateLeanForCache } from "@/lib/demographics/cachedStateLean";

// GET /api/admin/demographics — Returns demographic categories and optionally a single state's demographics.
// Auth: requireAdmin
// Errors: 401, 403
export async function GET(request: Request) {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const { searchParams } = new URL(request.url);
    const stateId = searchParams.get("state");

    const db = await getDb();

    // Always fetch categories
    const categories = await db
      .collection<DemographicCategory>("demographicCategories")
      .find({})
      .toArray();

    let stateDemographics: StateDemographics | null = null;
    if (stateId) {
      stateDemographics = await db
        .collection<StateDemographics>("stateDemographics")
        .findOne({ _id: stateId.toUpperCase() });
    }

    return NextResponse.json({
      categories,
      stateDemographics,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}

// PATCH /api/admin/demographics — Updates a state's demographic group weights and recalculates cached political leans.
// Auth: requireAdmin
// Errors: 400, 401, 403, 404
export async function PATCH(request: Request) {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;
    const { admin } = auth;

    const parsed = await parseJsonBody(request, adminDemographicsPatchSchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }
    const { stateId, countryId, categoryWeights, groups } = parsed.data;

    const db = await getDb();

    // Validate state exists (scope by countryId to avoid cross-country ID collisions).
    const state = await db
      .collection<State>("states")
      .findOne({ _id: stateId.toUpperCase(), countryId: countryId.toUpperCase() as CountryId });
    if (!state) {
      return NextResponse.json({ error: "State not found" }, { status: 404 });
    }

    // Build update object
    const updateData: Partial<StateDemographics> = {
      lastUpdated: new Date(),
    };

    if (categoryWeights) {
      if (!validateCategoryWeights(categoryWeights as unknown as CategoryWeights)) {
        return NextResponse.json({ error: "Category weights must sum to 100" }, { status: 400 });
      }
      updateData.categoryWeights = categoryWeights as unknown as CategoryWeights;
    }

    if (groups) {
      updateData.groups = groups as Record<string, StateDemographicGroup>;
    }

    // Update or insert
    await db
      .collection<StateDemographics>("stateDemographics")
      .updateOne({ _id: stateId.toUpperCase() }, { $set: updateData }, { upsert: true });

    // Recalculate cached leans
    const categories = await db
      .collection<DemographicCategory>("demographicCategories")
      .find({})
      .toArray();

    const updatedDemographics = await db
      .collection<StateDemographics>("stateDemographics")
      .findOne({ _id: stateId.toUpperCase() });

    if (updatedDemographics) {
      const [gameState, demographicDefaults] = await Promise.all([
        db.collection<GameState>("gameState").findOne(
          { _id: "current" },
          {
            projection: {
              preset: 1,
              currentYear: 1,
              startingYear: 1,
              eraSystemEnabled: 1,
            },
          }
        ),
        db
          .collection<StateDemographics>("demographicDefaults")
          .findOne({ _id: stateId.toUpperCase() }),
      ]);
      const calculatedLean = calculateStateLeanForCache(updatedDemographics, categories, {
        countryId: updatedDemographics.countryId,
        stateId: updatedDemographics._id,
        preset: gameState?.preset,
        demographicDefaults,
        year: gameState?.eraSystemEnabled ? gameState.currentYear : null,
        startingYear: gameState?.startingYear,
      });

      // Update cached values in stateDemographics
      await db.collection<StateDemographics>("stateDemographics").updateOne(
        { _id: stateId.toUpperCase() },
        {
          $set: {
            cachedEconomicLean: calculatedLean.economicLean,
            cachedSocialLean: calculatedLean.socialLean,
          },
        }
      );

      // Also update state collection for quick access
      await db.collection<State>("states").updateOne(
        { _id: stateId.toUpperCase() },
        {
          $set: {
            cachedEconomicLean: calculatedLean.economicLean,
            cachedSocialLean: calculatedLean.socialLean,
            demographicsLastUpdated: new Date(),
          },
        }
      );
    }

    // Log the update
    await db.collection<AdminLog>("adminLogs").insertOne({
      category: "system",
      action: "demographics_updated",
      username: "SYSTEM",
      adminUsername: admin.username,
      details: `Demographics updated for ${state.name} (${stateId.toUpperCase()})`,
      createdAt: new Date(),
    } as AdminLog);

    return NextResponse.json({
      success: true,
      message: `Demographics updated for ${state.name}`,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}

// POST /api/admin/demographics — Overwrites the demographic defaults collection with the current live state demographics.
// Auth: requireAdmin
// Errors: 400, 401, 403
export async function POST(request: Request) {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;
    const { admin } = auth;

    const parsed = await parseJsonBody(request, adminDemographicsPostSchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }

    const db = await getDb();

    // Get all current state demographics
    const currentDemographics = await db
      .collection<StateDemographics>("stateDemographics")
      .find({})
      .toArray();

    if (currentDemographics.length === 0) {
      return NextResponse.json(
        { error: "No demographics data found to save as defaults" },
        { status: 400 }
      );
    }

    // Clear existing defaults and insert current values
    await db.collection<StateDemographics>("demographicDefaults").deleteMany({});

    for (const demo of currentDemographics) {
      await db.collection<StateDemographics>("demographicDefaults").insertOne({
        _id: demo._id,
        categoryWeights: demo.categoryWeights,
        groups: demo.groups,
        lastUpdated: new Date(),
      } as StateDemographics);
    }

    // Log the action
    await db.collection<AdminLog>("adminLogs").insertOne({
      category: "system",
      action: "demographics_defaults_overwritten",
      username: "SYSTEM",
      adminUsername: admin.username,
      details: `Default demographics overwritten with current values (${currentDemographics.length} states)`,
      createdAt: new Date(),
    } as AdminLog);

    return NextResponse.json({
      success: true,
      message: `Default demographics saved for ${currentDemographics.length} states`,
      statesUpdated: currentDemographics.length,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
