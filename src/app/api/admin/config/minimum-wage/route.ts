import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/mongodb";
import { requireAdmin } from "@/lib/api/requireAdmin";
import { handleRouteError } from "@/lib/api/errors";
import { parseJsonBody } from "@/lib/api/validate";
import { createAdminLog } from "@/lib/adminLog";
import { clampKaitzRatio, MIN_WAGE_KAITZ_MAX } from "@/lib/labour/laborCost";
import type { FederalBudget } from "@/lib/db/types";

const patchSchema = z.object({
  countryId: z.string().min(1).max(8),
  // Kaitz ratio (minimum wage ÷ median wage), 0 = no floor.
  kaitzRatio: z.number().min(0).max(MIN_WAGE_KAITZ_MAX),
});

// GET /api/admin/config/minimum-wage — per-country minimum-wage Kaitz ratios
// Auth: requireAdmin
// Errors: 403
export async function GET() {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const db = await getDb();
    const budgets = await db
      .collection<FederalBudget>("federalBudget")
      .find({}, { projection: { countryId: 1, minimumWageKaitzRatio: 1 } })
      .toArray();

    const ratios: Record<string, number> = {};
    for (const b of budgets) {
      if (b.countryId) ratios[b.countryId] = b.minimumWageKaitzRatio ?? 0;
    }
    return NextResponse.json({ ratios });
  } catch (error) {
    return handleRouteError(error);
  }
}

// PATCH /api/admin/config/minimum-wage — set a country's minimum-wage Kaitz ratio
// Auth: requireAdmin
// Errors: 400, 403, 404
//
// Floors low-pay sectors' labor cost in the corporation turn (only when
// labourSystemMode ≥ "wages"; inert otherwise). See
// docs/plans/2026-06-30-labour-system.md (Phase 3).
export async function PATCH(request: Request) {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const parsed = await parseJsonBody(request, patchSchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }

    const { countryId } = parsed.data;
    const kaitzRatio = clampKaitzRatio(parsed.data.kaitzRatio);

    const db = await getDb();
    const result = await db
      .collection<FederalBudget>("federalBudget")
      .updateOne({ countryId }, { $set: { minimumWageKaitzRatio: kaitzRatio } });

    if (result.matchedCount === 0) {
      return NextResponse.json(
        { error: `No federal budget found for country "${countryId}".` },
        { status: 404 }
      );
    }

    await createAdminLog({
      category: "system",
      action: "minimum_wage_set",
      username: auth.admin.username,
      adminUsername: auth.admin.username,
      details:
        kaitzRatio > 0
          ? `Minimum wage for ${countryId} set to Kaitz ratio ${kaitzRatio.toFixed(2)} (min wage = ${Math.round(kaitzRatio * 100)}% of median wage).`
          : `Minimum wage for ${countryId} removed (no floor).`,
    });

    return NextResponse.json({ success: true, countryId, kaitzRatio });
  } catch (error) {
    return handleRouteError(error);
  }
}
