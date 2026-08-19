import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { requireAdmin } from "@/lib/api/requireAdmin";
import { handleRouteError } from "@/lib/api/errors";
import { parseJsonBody } from "@/lib/api/validate";
import { adminDemographicsPostSchema } from "@/lib/api/schemas/admin";
import type { DemographicCategory, StateDemographics, AdminLog } from "@/lib/db/types";

// GET /api/admin/demographics — Returns demographic categories and optionally a single state's demographics.
// Auth: requireAdmin
// Errors: 403
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

// PATCH was removed. It was the only surface that could author an arbitrary
// `categoryWeights` map and arbitrary archetype `groups` entries by hand. Both
// are derived from the seeds and the Layer-1 census now, so hand-editing them
// could only put a region out of step with the substrate the vote engine reads.
// Use Reseed Demographics (POST /api/admin/demographics/reseed) instead.

// POST /api/admin/demographics — Overwrites the demographic defaults collection with the current live state demographics.
// Auth: requireAdmin
// Errors: 400, 403
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
