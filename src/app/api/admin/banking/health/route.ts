import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { requireAdmin } from "@/lib/api/requireAdmin";
import { handleRouteError } from "@/lib/api/errors";
import { buildBankingHealth } from "@/lib/banking/health";

// GET /api/admin/banking/health - per-currency banking reconciliation, the
// unfinished settlement queue and the product counters for recent turns.
// Auth: requireAdmin only. Works when privateBankingEnabled is false.
export async function GET() {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const db = await getDb();
    return NextResponse.json(await buildBankingHealth(db));
  } catch (error) {
    return handleRouteError(error);
  }
}
