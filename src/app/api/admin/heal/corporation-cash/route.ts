import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { requireAdmin } from "@/lib/api/requireAdmin";
import { handleRouteError } from "@/lib/api/errors";
import { parseJsonBody } from "@/lib/api/validate";
import { z } from "zod";
import type { Corporation } from "@/lib/db/types";

const setCashSchema = z.object({
  liquidCapital: z.number().min(0).max(1_000_000_000),
});

/**
 * GET /api/admin/heal/corporation-cash
 * Returns current liquidCapital for all corporations (diagnostic).
 */
export async function GET() {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const db = await getDb();
    const corporations = await db
      .collection<Corporation>("corporations")
      .find({}, { projection: { name: 1, liquidCapital: 1 } })
      .toArray();

    return NextResponse.json({
      corporations: corporations.map((c) => ({
        id: c._id.toString(),
        name: c.name,
        liquidCapital: c.liquidCapital ?? 0,
      })),
      count: corporations.length,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}

/**
 * POST /api/admin/heal/corporation-cash
 * Sets liquidCapital to a specified amount for ALL corporations.
 */
export async function POST(request: NextRequest) {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const parsed = await parseJsonBody(request, setCashSchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }
    const { liquidCapital } = parsed.data;

    const db = await getDb();

    const result = await db
      .collection<Corporation>("corporations")
      .updateMany({}, { $set: { liquidCapital } });

    // Log admin action
    await db.collection("adminLogs").insertOne({
      action: "heal_corporation_cash",
      admin: auth.admin.username,
      details: { liquidCapital, corporationsUpdated: result.modifiedCount },
      timestamp: new Date(),
    });

    return NextResponse.json({
      message: `Set liquidCapital to $${liquidCapital.toLocaleString()} for ${result.modifiedCount} corporation(s)`,
      corporationsUpdated: result.modifiedCount,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
