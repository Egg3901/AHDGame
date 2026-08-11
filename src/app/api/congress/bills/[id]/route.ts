/**
 * GET   /api/congress/bills/[id] — full bill detail.
 * POST  /api/congress/bills/[id] — bill actions.
 */
import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { requireBasicAuth } from "@/lib/api/requireAuth";
import { getAuthUser } from "@/lib/auth";
import { resolveBillCountryId } from "@/lib/congress/resolveBillCountryId";
import { parseJsonBody } from "@/lib/api/validate";
import { handleRouteError } from "@/lib/api/errors";
import { checkRateLimit, CONGRESS_LIMITS, rateLimitResponse } from "@/lib/api/rateLimit";
import { logRequest } from "@/lib/api/requestLog";
import { billActionSchema } from "@/lib/api/schemas/congress";
import { getNationalBillDetail } from "@/lib/legislature/queries/nationalBillQueries";
import { performNationalBillAction } from "@/lib/legislature/commands/nationalBillActions";
import type { Bill, Character } from "@/lib/db/types";

// GET /api/congress/bills/[id] — Returns full detail for a single bill including vote breakdowns.
// Auth: public
// Errors: 400, 404
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    if (!ObjectId.isValid(id)) {
      return NextResponse.json({ error: "Invalid bill ID" }, { status: 400 });
    }

    const [db, authUser] = await Promise.all([getDb(), getAuthUser().catch(() => null)]);
    const bill = await getNationalBillDetail(db, id, authUser);
    if (!bill) {
      return NextResponse.json({ error: "Bill not found" }, { status: 404 });
    }

    return NextResponse.json(bill);
  } catch (error) {
    return handleRouteError(error);
  }
}

// POST /api/congress/bills/[id] — Perform a national bill action.
// Auth: requireBasicAuth
// Errors: 400, 401, 403, 404, 409, 429
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const start = Date.now();
    const path = new URL(request.url).pathname;
    const { id } = await params;
    if (!ObjectId.isValid(id)) {
      logRequest("POST", path, 400, Date.now() - start);
      return NextResponse.json({ error: "Invalid bill ID" }, { status: 400 });
    }

    const auth = await requireBasicAuth();
    if (!auth.ok) {
      logRequest("POST", path, 401, Date.now() - start);
      return auth.response;
    }

    const limit = checkRateLimit(
      `congress:${auth.user.userId}`,
      CONGRESS_LIMITS.maxRequests,
      CONGRESS_LIMITS.windowMs
    );
    if (!limit.ok) {
      logRequest("POST", path, 429, Date.now() - start);
      return rateLimitResponse(limit.retryAfter);
    }

    const db = await getDb();
    const character = await db
      .collection<Character>("characters")
      .findOne({ userId: new ObjectId(auth.user.userId) });
    if (!character) {
      logRequest("POST", path, 400, Date.now() - start);
      return NextResponse.json({ error: "No character" }, { status: 400 });
    }

    const bill = await db.collection<Bill>("bills").findOne({ _id: new ObjectId(id) });
    if (!bill) {
      logRequest("POST", path, 404, Date.now() - start);
      return NextResponse.json({ error: "Bill not found" }, { status: 404 });
    }

    const parsed = await parseJsonBody(request, billActionSchema);
    if (!parsed.success) {
      logRequest("POST", path, parsed.status, Date.now() - start);
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }

    const countryId = await resolveBillCountryId(db, bill);
    const result = await performNationalBillAction(db, {
      authUser: auth.user,
      character,
      bill,
      countryId,
      input: parsed.data,
    });

    logRequest("POST", path, result.status, Date.now() - start);
    return NextResponse.json(result.body, { status: result.status });
  } catch (error) {
    return handleRouteError(error);
  }
}
