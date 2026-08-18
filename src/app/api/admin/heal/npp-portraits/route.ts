// GET diagnoses NPPs missing gender/ethnicity/avatarUrl fields.
// POST backfills them: gender inferred from first name, ethnicity weighted by country, portrait selected from image pool.
// Auth: requireAdmin
// Errors: 403
import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/api/requireAdmin";
import { handleRouteError } from "@/lib/api/errors";
import { getDb } from "@/lib/mongodb";
import type { NPP } from "@/lib/db/types";
import { inferGenderFromFirstName } from "@/lib/npp/nameGenerator";
import { weightedRandomEthnicity, selectPoliticianImage } from "@/lib/npp/generator";
import { getEraContext } from "@/lib/era/context";
import type { CountryId } from "@/lib/constants/countries";

/**
 * GET /api/admin/heal/npp-portraits
 * Diagnose NPPs missing portrait demographic fields.
 */
export async function GET() {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const db = await getDb();

    const total = await db.collection<NPP>("npps").countDocuments({ retiredAt: null });

    const missingGender = await db.collection<NPP>("npps").countDocuments({
      retiredAt: null,
      gender: { $exists: false },
    });
    const missingEthnicity = await db.collection<NPP>("npps").countDocuments({
      retiredAt: null,
      ethnicity: { $exists: false },
    });
    const missingAvatar = await db.collection<NPP>("npps").countDocuments({
      retiredAt: null,
      avatarUrl: { $exists: false },
    });

    const needsUpdate = await db.collection<NPP>("npps").countDocuments({
      retiredAt: null,
      $or: [
        { gender: { $exists: false } },
        { ethnicity: { $exists: false } },
        { avatarUrl: { $exists: false } },
      ],
    });

    const isOk = needsUpdate === 0;

    return NextResponse.json({
      status: isOk ? "ok" : "issues_found",
      message: isOk
        ? `All ${total} active NPPs have portrait fields set.`
        : `${needsUpdate} of ${total} active NPPs are missing one or more portrait fields.`,
      total,
      missingGender,
      missingEthnicity,
      missingAvatar,
      needsUpdate,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}

/**
 * POST /api/admin/heal/npp-portraits
 * Backfill gender, ethnicity, and avatarUrl on NPPs that are missing any of them.
 * Existing values are preserved — only absent fields are filled in.
 */
export async function POST() {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const db = await getDb();
    // Read once per heal run — the clock is per-world, the filter per-NPP.
    const eraYear = (await getEraContext(db)).year;

    const npps = await db
      .collection<NPP>("npps")
      .find({
        retiredAt: null,
        $or: [
          { gender: { $exists: false } },
          { ethnicity: { $exists: false } },
          { avatarUrl: { $exists: false } },
        ],
      })
      .project<Pick<NPP, "_id" | "name" | "gender" | "ethnicity" | "avatarUrl" | "countryId">>({
        name: 1,
        gender: 1,
        ethnicity: 1,
        avatarUrl: 1,
        countryId: 1,
      })
      .toArray();

    let updated = 0;
    let skippedNoImage = 0;

    for (const npp of npps) {
      const countryId: CountryId = npp.countryId ?? "US";

      // Preserve existing values; only fill missing ones
      const gender = npp.gender ?? inferGenderFromFirstName(npp.name);
      const ethnicity = npp.ethnicity ?? weightedRandomEthnicity(countryId);

      const setOps: Partial<Pick<NPP, "gender" | "ethnicity" | "avatarUrl" | "updatedAt">> = {};

      if (!npp.gender) setOps.gender = gender;
      if (!npp.ethnicity) setOps.ethnicity = ethnicity;

      if (!npp.avatarUrl) {
        // Same era filter as generation, or healing would re-introduce the
        // anachronisms it is meant to clear.
        const avatarUrl = selectPoliticianImage(countryId, gender, ethnicity, npp.name, eraYear);
        if (avatarUrl) {
          setOps.avatarUrl = avatarUrl;
        } else {
          // Image pool has no entries for this country — skip avatarUrl for this NPP
          skippedNoImage++;
        }
      }

      if (Object.keys(setOps).length > 0) {
        setOps.updatedAt = new Date();
        await db.collection<NPP>("npps").updateOne({ _id: npp._id }, { $set: setOps });
        updated++;
      }
    }

    const messages: string[] = [];
    if (updated > 0) {
      messages.push(`Backfilled portrait fields on ${updated} NPPs`);
    } else {
      messages.push("All NPPs already have portrait fields set");
    }
    if (skippedNoImage > 0) {
      messages.push(`${skippedNoImage} NPPs skipped (no image pool entry for their country)`);
    }

    return NextResponse.json({
      success: true,
      message: messages.join(". ") + ".",
      updated,
      skippedNoImage,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
