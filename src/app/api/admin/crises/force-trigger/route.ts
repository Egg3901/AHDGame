import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/mongodb";
import { requireAdmin } from "@/lib/api/requireAdmin";
import { handleRouteError } from "@/lib/api/errors";
import { parseJsonBody } from "@/lib/api/validate";
import { forceSpawnCrisis } from "@/lib/crises/autoCrisisSpawn";
import { COUNTRY_ORDER } from "@/lib/constants/countries";
import type { CountryId } from "@/lib/constants/countries";

const bodySchema = z.object({
  templateKey: z.string().min(1),
  countryId: z.enum(COUNTRY_ORDER as [CountryId, ...CountryId[]]).optional(),
});

/**
 * POST /api/admin/crises/force-trigger
 * Immediately spawn an auto-crisis template (disaster / condition / random),
 * bypassing cooldown and trigger conditions but still stamping the cooldown.
 * Auth: requireAdmin
 */
export async function POST(request: Request) {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const parsed = await parseJsonBody(request, bodySchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }

    const db = await getDb();
    const gameState = await db.collection("gameState").findOne({ _id: "current" } as never);
    const currentTurn = (gameState as { currentTurn?: number } | null)?.currentTurn ?? 1;

    const result = await forceSpawnCrisis(
      db,
      parsed.data.templateKey,
      currentTurn,
      parsed.data.countryId
    );
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }

    return NextResponse.json({ success: true, crisisId: result.crisisId });
  } catch (err) {
    return handleRouteError(err);
  }
}
