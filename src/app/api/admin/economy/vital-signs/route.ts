import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/api/requireAdmin";
import { handleRouteError } from "@/lib/api/errors";
import type { EconomicVitalSigns } from "@/lib/db/types";
import { evaluateCorporateNoHolderAlert } from "@/lib/economy/corporateNoHolderAlert/rules";
import { getDb } from "@/lib/mongodb";

// Keep this read-only route off the full turn-snapshot import graph.
const ECONOMIC_VITAL_SIGNS_COLLECTION = "economicVitalSigns";

const querySchema = z.object({
  turn: z.coerce.number().int().nonnegative().optional(),
});

// GET /api/admin/economy/vital-signs - Return the latest or requested aggregate economic snapshot.
// Auth: requireAdmin
// Errors: 400, 403, 404
export async function GET(request: Request) {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const parsed = querySchema.safeParse(
      Object.fromEntries(new URL(request.url).searchParams.entries())
    );
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid query", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const db = await getDb();
    const snapshot =
      parsed.data.turn == null
        ? await db
            .collection<EconomicVitalSigns>(ECONOMIC_VITAL_SIGNS_COLLECTION)
            .findOne({}, { sort: { turn: -1 } })
        : await db
            .collection<EconomicVitalSigns>(ECONOMIC_VITAL_SIGNS_COLLECTION)
            .findOne({ turn: parsed.data.turn });

    if (!snapshot) {
      return NextResponse.json(
        { error: "Economic vital signs snapshot not found" },
        { status: 404 }
      );
    }
    return NextResponse.json({
      snapshot,
      alerts: { corporateNoHolder: evaluateCorporateNoHolderAlert(snapshot) },
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
