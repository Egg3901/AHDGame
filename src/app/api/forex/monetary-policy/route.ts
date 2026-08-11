// GET /api/forex/monetary-policy - Prime rate, inflation, and GDP growth histories for active forex countries.
// Auth: public
// Errors: 403
import { NextResponse } from "next/server";
import { handleRouteError } from "@/lib/api/errors";
import { getDb } from "@/lib/mongodb";
import { loadForexMonetaryPolicy } from "@/lib/monetaryPolicy/queries/forexMonetaryPolicy";

export async function GET() {
  try {
    const db = await getDb();
    const detail = await loadForexMonetaryPolicy({ db });
    if (!detail.ok) {
      return NextResponse.json({ error: detail.error }, { status: detail.status });
    }

    return NextResponse.json(detail.body);
  } catch (error) {
    return handleRouteError(error);
  }
}
