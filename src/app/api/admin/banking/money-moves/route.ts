import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/mongodb";
import { requireAdmin } from "@/lib/api/requireAdmin";
import { parseJsonBody } from "@/lib/api/validate";
import { handleRouteError } from "@/lib/api/errors";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
import { closeMoneyMove, listUnfinishedMoneyMoves } from "@/lib/banking/moneyMove";

/**
 * The repair queue for banking money movements.
 *
 * On a database with no transactions a multi-document move can land half way.
 * The primitive records which legs applied, which is worth nothing if no
 * operator can read it: an invisible hole is exactly what put private banking
 * behind a kill switch in the first place.
 *
 * GET lists what started and did not finish. POST closes a record once the
 * money has been moved by hand. It deliberately does NOT move money itself:
 * finishing a half-applied move needs somebody to look at which legs landed,
 * and an automatic retry is how a partial payment becomes a double payment.
 */

// GET /api/admin/banking/money-moves - unfinished banking money movements.
// Auth: requireAdmin only. Works when privateBankingEnabled is false.
export async function GET() {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const db = await getDb();
    const rows = await listUnfinishedMoneyMoves(db, { limit: 200 });
    return NextResponse.json({ moves: rows, count: rows.length });
  } catch (error) {
    return handleRouteError(error);
  }
}

const closeSchema = z.object({
  key: z.string().min(1).max(200),
  note: z.string().min(1).max(500),
});

// POST /api/admin/banking/money-moves - mark a repaired move done.
// Errors: 400, 403, 404
export async function POST(request: Request) {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const rateLimit = checkRateLimit(auth.admin.userId, 20, 60_000);
    if (!rateLimit.ok) return rateLimitResponse(rateLimit.retryAfter);

    const parsed = await parseJsonBody(request, closeSchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }

    const db = await getDb();
    const closed = await closeMoneyMove(db, parsed.data.key, parsed.data.note);
    if (!closed) {
      return NextResponse.json({ error: "No unfinished move with that key" }, { status: 404 });
    }
    return NextResponse.json({ success: true });
  } catch (error) {
    return handleRouteError(error);
  }
}
