// GET  /api/admin/corporations/heal-captured-unowned — dry-run: preview captured-market fix
// POST /api/admin/corporations/heal-captured-unowned — absorb unowned + merge intruder sectors
// Auth: requireAdmin

import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { requireAdmin } from "@/lib/api/requireAdmin";
import { handleRouteError } from "@/lib/api/errors";
import { healCapturedMarkets } from "@/lib/nationalization/stateControlledBuckets";

export async function GET() {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const db = await getDb();
    const result = await healCapturedMarkets(db, { dryRun: true });
    return NextResponse.json(result);
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function POST() {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const db = await getDb();
    const result = await healCapturedMarkets(db, { dryRun: false });
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    return handleRouteError(error);
  }
}
