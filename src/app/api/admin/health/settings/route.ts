import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { requireAdmin } from "@/lib/api/requireAdmin";
import { parseJsonBody } from "@/lib/api/validate";
import { handleRouteError } from "@/lib/api/errors";
import { z } from "zod";
import type { SystemSettings } from "@/lib/db/types";

const patchSchema = z.object({
  integrityCheckCadenceTurns: z.number().int().min(1).max(48),
});

/**
 * Get or update health check settings (integrity check cadence).
 * Auth: requireAdmin()
 * Errors: 401, 400, 500
 */
export async function GET() {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const db = await getDb();
    const config = await db
      .collection<SystemSettings>("systemSettings")
      .findOne({ _id: "healthConfig" });

    return NextResponse.json({
      integrityCheckCadenceTurns: config?.integrityCheckCadenceTurns ?? 1,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function PATCH(request: Request) {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const parsed = await parseJsonBody(request, patchSchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }

    const db = await getDb();
    await db.collection<SystemSettings>("systemSettings").updateOne(
      { _id: "healthConfig" },
      {
        $set: {
          integrityCheckCadenceTurns: parsed.data.integrityCheckCadenceTurns,
          updatedBy: auth.admin.userId,
          updatedAt: new Date(),
        },
      },
      { upsert: true }
    );

    return NextResponse.json({
      success: true,
      integrityCheckCadenceTurns: parsed.data.integrityCheckCadenceTurns,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
