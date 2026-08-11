import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/mongodb";
import { requireAdmin } from "@/lib/api/requireAdmin";
import { handleRouteError } from "@/lib/api/errors";
import { parseJsonBody } from "@/lib/api/validate";
import type { DemographicConfigOverride } from "@/lib/db/types/demographicConfigOverride";
import type { EraId } from "@/lib/seeds/presetSelector";

const ERAS = ["1979", "1991", "1999", "2007", "2019", "2023"] as const;
const COUNTRIES = ["US", "UK", "DE", "JP", "IE", "BR", "CN"] as const;
const positionSchema = z.object({
  economicLean: z.number().min(-5).max(5),
  socialLean: z.number().min(-5).max(5),
});
const weightSchema = z.object({ dim: z.string(), key: z.string(), w: z.number() });
const compositionSchema = z.object({
  weights: z.array(weightSchema),
  civicMultiplier: z.number(),
});
const bodySchema = z.object({
  country: z.enum(COUNTRIES),
  era: z.enum(ERAS),
  positions: z.record(z.string(), z.record(z.string(), positionSchema)),
  // Global (per country+era) overrides authored alongside positions. Per-state
  // Layer-1 share is census-driven and intentionally not persisted here.
  turnout: z.record(z.string(), z.record(z.string(), z.number())).optional(),
  composition: z.record(z.string(), compositionSchema).optional(),
});

// POST /api/admin/position-editor/apply — persist authored global Layer-1 positions for a country+era.
// Auth: requireAdmin
export async function POST(request: Request) {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const parsed = await parseJsonBody(request, bodySchema);
    if (!parsed.success)
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });

    const { country, era, positions, turnout, composition } = parsed.data;
    const db = await getDb();
    const doc: DemographicConfigOverride = {
      _id: `${country}:${era}`,
      countryId: country,
      era: era as EraId,
      positions: positions as DemographicConfigOverride["positions"],
      ...(turnout ? { turnout } : {}),
      ...(composition ? { composition } : {}),
      updatedAt: new Date(),
      updatedBy: auth.admin.username,
    };
    // Replace the whole doc so clearing turnout/composition on re-apply unsets them.
    await db
      .collection<DemographicConfigOverride>("demographicConfigOverrides")
      .replaceOne({ _id: doc._id }, doc, { upsert: true });

    return NextResponse.json({
      success: true,
      country: doc.countryId,
      era: doc.era,
      note: `Saved ${country}:${era}. Reseed (or reset the world) with the Layer-1 flag ON for this to take effect.`,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
