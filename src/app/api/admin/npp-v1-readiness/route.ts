/**
 * GET /api/admin/npp-v1-readiness — per-country V1 autonomy seeded-readiness
 * diagnostic. Reports, for each registered country, whether it has the seeded
 * entities the V1 governing brain needs (states, NPPs, parties, lower-chamber
 * seats, cabinet posts). Auth: requireAdmin.
 */

import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { requireAdmin } from "@/lib/api/requireAdmin";
import { handleRouteError } from "@/lib/api/errors";
import { assessAllV1Readiness } from "@/lib/nppAutonomy/v1Readiness";

export async function GET() {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;
    const db = await getDb();
    const countries = await assessAllV1Readiness(db);
    return NextResponse.json({ countries });
  } catch (error) {
    return handleRouteError(error);
  }
}
