/**
 * POST /api/admin/demographics/reseed
 *
 * Upserts demographic categories and state demographics from the seed data.
 * Admin-only. Removes legacy categories (race, gender, education, wealth, age, ideology)
 * so only the new voterGroups schema remains. Clears stored polls from all characters
 * so they commission fresh polls with the new 12 voter groups.
 *
 * Optional JSON body:
 *   { era?: EraId, countryId?: string, skipPollClear?: boolean }
 * Defaults: era="2019", countryId="US", skipPollClear=false
 * Backward-compatible: callers that POST with no body get US/2019 behaviour.
 *
 * For countryId !== "US", uses the international Layer-1 model path
 * (getCountryLayer1Model + buildModelRegionDemographics). Returns 400 if
 * no model exists for the requested country+era.
 *
 * A pre-reseed snapshot of the affected stateDemographics docs is written to
 * stateDemographicsBackup (last 3 per country+era kept).
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/api/requireAdmin";
import { handleRouteError } from "@/lib/api/errors";
import { parseJsonBody } from "@/lib/api/validate";
import { getDb } from "@/lib/mongodb";
import type { Db } from "mongodb";
import type { DemographicCategory, State, StateDemographics } from "@/lib/db/types";
import { demographicCategories } from "@/lib/seeds/demographicCategories";
import { registerAndGenerate } from "@/lib/seeds/stateDemographics";
import { isLayer1PositionsEnabled } from "@/lib/seeds/layer1PositionsFlag";
import { calculateStateLean } from "@/lib/utils/demographics";
import { calculateStateLeanForCache } from "@/lib/demographics/cachedStateLean";
import type { Layer1Config } from "@/lib/seeds/stateDemographics";
import type { EraId } from "@/lib/seeds/presetSelector";

const LEGACY_CATEGORY_IDS = ["race", "gender", "education", "wealth", "age", "ideology"] as const;

const VALID_ERAS = ["1953", "1979", "1991", "1999", "2007", "2019", "2023"] as const;

const ReseedBodySchema = z
  .object({
    era: z.enum(VALID_ERAS).optional(),
    countryId: z.string().min(1).optional(),
    skipPollClear: z.boolean().optional(),
  })
  .optional();

// POST /api/admin/demographics/reseed — era-aware, international-scoped reseed.
// Auth: requireAdmin
// Errors: 403, 400 (unknown country+era)
export async function POST(request: Request) {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    // Parse optional body — empty/absent body falls back to defaults
    // (US/2019); a present-but-malformed body is rejected. Reads text +
    // Zod-validates rather than raw JSON parsing, per the validation convention.
    let era: EraId = "2019";
    let countryId = "US";
    let skipPollClear = false;
    const bodyResult = await parseJsonBody(request, ReseedBodySchema);
    if (bodyResult.success && bodyResult.data) {
      if (bodyResult.data.era) era = bodyResult.data.era;
      if (bodyResult.data.countryId) countryId = bodyResult.data.countryId;
      if (bodyResult.data.skipPollClear !== undefined)
        skipPollClear = bodyResult.data.skipPollClear;
    }

    const db = await getDb();
    const layer1Positions = await isLayer1PositionsEnabled();

    // ── International path ──────────────────────────────────────────────────
    if (countryId !== "US") {
      const { getCountryLayer1Model, buildModelRegionDemographics } =
        await import("@/lib/seeds/international");
      const { loadFullOverride } = await import("@/lib/seeds/loadEraPositionOverride");

      const model = getCountryLayer1Model(countryId, era);
      if (!model) {
        return NextResponse.json(
          { error: `No Layer-1 model for ${countryId}:${era}` },
          { status: 400 }
        );
      }

      const full = layer1Positions ? await loadFullOverride(countryId, era) : null;
      const regionDemographics = buildModelRegionDemographics(
        model,
        full?.positions ?? undefined,
        full ? { turnout: full.turnout, composition: full.composition } : undefined
      );

      // Pre-reseed snapshot
      const regionIds = regionDemographics.map((r) => r._id);
      const snapshotId = await takeSnapshot(db, countryId, era, regionIds, auth.admin.username);

      // Categories must come from the DB, not the US static import: a region's
      // lean is summed only over categories named in its `categoryWeights`, so
      // scoring an RU/DD/UK region against US voter groups matches nothing and
      // silently yields a 0/0 lean (#3752).
      const countryCategories = await db
        .collection<DemographicCategory>("demographicCategories")
        .find({})
        .toArray();

      for (const sd of regionDemographics) {
        await db
          .collection<StateDemographics>("stateDemographics")
          .updateOne({ _id: sd._id }, { $set: sd }, { upsert: true });
        await db
          .collection<StateDemographics>("demographicDefaults")
          .updateOne({ _id: sd._id }, { $set: sd }, { upsert: true });
        const calculatedLean = calculateStateLean(sd, countryCategories);
        await db.collection<State>("states").updateOne(
          { _id: sd._id },
          {
            $set: {
              cachedEconomicLean: calculatedLean.economicLean,
              cachedSocialLean: calculatedLean.socialLean,
              demographicsLastUpdated: new Date(),
            },
          }
        );
      }

      return NextResponse.json({
        success: true,
        countryId,
        era,
        layer1Positions,
        snapshotId,
        statesCount: regionDemographics.length,
        message: `Reseeded ${regionDemographics.length} ${countryId} regions (era ${era}).`,
      });
    }

    // ── US path ─────────────────────────────────────────────────────────────
    const { loadEraFullOverride } = await import("@/lib/seeds/loadEraPositionOverride");
    const override = layer1Positions ? ((await loadEraFullOverride(era)) ?? undefined) : undefined;

    // Era-aware census bundle
    const { stateCensusData } = await import("@/lib/seeds/stateCensusData");
    const censusBundle = await resolveUsCensusBundle(
      era,
      stateCensusData as Record<string, Layer1Config>
    );

    const regenerated = Object.entries(censusBundle).map(([stateId, config]) =>
      registerAndGenerate(stateId, config, era, {
        layer1Positions,
        positions: override?.positions,
        turnout: override?.turnout,
        composition: override?.composition,
      })
    );

    // Pre-reseed snapshot
    const stateIds = regenerated.map((r) => r._id);
    const snapshotId = await takeSnapshot(db, countryId, era, stateIds, auth.admin.username);

    // Upsert demographic categories (US-only; international uses country-specific categories)
    for (const category of demographicCategories) {
      await db
        .collection<DemographicCategory>("demographicCategories")
        .updateOne({ _id: category._id }, { $set: category }, { upsert: true });
    }

    // Remove legacy categories so only voterGroups remains
    if (LEGACY_CATEGORY_IDS.length > 0) {
      await db
        .collection<DemographicCategory>("demographicCategories")
        .deleteMany({ _id: { $in: LEGACY_CATEGORY_IDS } });
    }

    // Clear stored polls (skippable to avoid disrupting active players)
    let charactersCleared = 0;
    if (!skipPollClear) {
      const charsResult = await db
        .collection("characters")
        .updateMany({}, { $unset: { lastPoll: "", lastPollLarge: "" } });
      charactersCleared = charsResult.modifiedCount;
    }

    for (const sd of regenerated) {
      const calculatedLean = calculateStateLeanForCache(sd, demographicCategories, {
        countryId: "US",
        stateId: sd._id,
        preset: `${era}-default`,
        demographicDefaults: sd,
      });
      const cachedDemographics = {
        ...sd,
        cachedEconomicLean: calculatedLean.economicLean,
        cachedSocialLean: calculatedLean.socialLean,
      };
      await db
        .collection<StateDemographics>("stateDemographics")
        .updateOne({ _id: sd._id }, { $set: cachedDemographics }, { upsert: true });
      await db
        .collection<StateDemographics>("demographicDefaults")
        .updateOne({ _id: sd._id }, { $set: cachedDemographics }, { upsert: true });

      // Refresh cached leans on states
      await db.collection<State>("states").updateOne(
        { _id: sd._id },
        {
          $set: {
            cachedEconomicLean: calculatedLean.economicLean,
            cachedSocialLean: calculatedLean.socialLean,
            demographicsLastUpdated: new Date(),
          },
        }
      );
    }

    const groupsPerCategory = demographicCategories.reduce(
      (s, c) => s + (c.groups?.length ?? 0),
      0
    );
    return NextResponse.json({
      success: true,
      countryId,
      era,
      layer1Positions,
      snapshotId,
      skipPollClear,
      message: `Reseeded ${demographicCategories.length} category (${groupsPerCategory} voter archetypes) and ${regenerated.length} state demographics (era ${era}). ${skipPollClear ? "Poll clear skipped." : `Cleared stored polls from ${charactersCleared} characters.`}`,
      categoriesCount: demographicCategories.length,
      groupsCount: groupsPerCategory,
      statesCount: regenerated.length,
      charactersCleared,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}

interface SnapshotDoc {
  _id: string;
  countryId: string;
  era: EraId;
  snapshotAt: string;
  triggeredBy: string;
  docs: unknown[];
}

/** Write current docs to stateDemographicsBackup; keep last 3 per country+era. */
async function takeSnapshot(
  db: Db,
  countryId: string,
  era: EraId,
  regionIds: string[],
  triggeredBy: string
): Promise<string> {
  const currentDocs = await db
    .collection<{ _id: string }>("stateDemographics")
    .find({ _id: { $in: regionIds } })
    .toArray();

  const snapshotId = `${countryId}:${era}:${Date.now()}`;
  await db.collection<SnapshotDoc>("stateDemographicsBackup").insertOne({
    _id: snapshotId,
    countryId,
    era,
    snapshotAt: new Date().toISOString(),
    triggeredBy,
    docs: currentDocs,
  });

  // Prune: keep last 3 snapshots per country+era
  const all = await db
    .collection<SnapshotDoc>("stateDemographicsBackup")
    .find({ countryId, era })
    .sort({ snapshotAt: -1 })
    .toArray();
  if (all.length > 3) {
    const toDelete = all.slice(3).map((s) => s._id);
    await db
      .collection<SnapshotDoc>("stateDemographicsBackup")
      .deleteMany({ _id: { $in: toDelete } });
  }

  return snapshotId;
}

/** Return the correct US census bundle for the requested era. */
async function resolveUsCensusBundle(
  era: EraId,
  fallback: Record<string, Layer1Config>
): Promise<Record<string, Layer1Config>> {
  switch (era) {
    case "1953": {
      // 1979 shares proxy with the 1979-authored positions blocks stripped
      // (previously fell through to the 2019 fallback bundle).
      const { stateCensusData1953 } = await import("@/lib/seeds/stateCensusData1953");
      return stateCensusData1953;
    }
    case "1979": {
      const { stateCensusData1979 } = await import("@/lib/seeds/stateCensusData1979");
      return stateCensusData1979;
    }
    case "1991": {
      const { stateCensusData1991 } = await import("@/lib/seeds/stateCensusData1991");
      return stateCensusData1991;
    }
    case "1999": {
      const { stateCensusData1999 } = await import("@/lib/seeds/stateCensusData1999");
      return stateCensusData1999;
    }
    case "2007": {
      const { stateCensusData2007 } = await import("@/lib/seeds/stateCensusData2007");
      return stateCensusData2007;
    }
    case "2023": {
      const { stateCensusData2023 } = await import("@/lib/seeds/stateCensusData2023");
      return stateCensusData2023;
    }
    default:
      return fallback;
  }
}
