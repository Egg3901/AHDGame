import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { z } from "zod";
import { getDb } from "@/lib/mongodb";
import { getAuthUserWithCharacter } from "@/lib/auth";
import { requireAuthWithCharacter } from "@/lib/api/requireAuth";
import { handleRouteError } from "@/lib/api/errors";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
import { parseJsonBody } from "@/lib/api/validate";
import { resolveBillCountryId } from "@/lib/congress/resolveBillCountryId";
import { createBillDiscussion } from "@/lib/legislature/discussions/discussionCommands";
import { getBillDiscussionsForViewer } from "@/lib/legislature/discussions/discussionQueries";
import type { BillDiscussionScope } from "@/lib/legislature/discussions/types";
import type { Bill } from "@/lib/db/types";

const createSchema = z.object({ content: z.string().min(1).max(1000).trim() });

async function resolveScope(
  db: Awaited<ReturnType<typeof getDb>>,
  id: string
): Promise<BillDiscussionScope | null> {
  if (!ObjectId.isValid(id)) return null;
  const bill = await db.collection<Bill>("bills").findOne({ _id: new ObjectId(id) });
  if (!bill) return null;
  const countryId = await resolveBillCountryId(db, bill);
  return { kind: "national", countryId, billId: id };
}

// GET /api/congress/bills/[id]/discussions — Paginated discussions (newest first, 10/page).
// Auth: public (viewer fields populated when logged in)
// Errors: 404
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const db = await getDb();
    const scope = await resolveScope(db, id);
    if (!scope) return NextResponse.json({ error: "Bill not found" }, { status: 404 });

    const page = Number(new URL(request.url).searchParams.get("page") ?? "1");
    const user = await getAuthUserWithCharacter().catch(() => null);
    return NextResponse.json(await getBillDiscussionsForViewer(db, scope, { user, page }));
  } catch (error) {
    return handleRouteError(error);
  }
}

// POST /api/congress/bills/[id]/discussions — Post a discussion (legislators only).
// Auth: requireAuthWithCharacter
// Errors: 400, 401, 403, 404, 429
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireAuthWithCharacter();
    if (!auth.ok) return auth.response;

    const rateLimit = checkRateLimit(auth.user.userId, 20, 60000);
    if (!rateLimit.ok) return rateLimitResponse(rateLimit.retryAfter);

    const parsed = await parseJsonBody(request, createSchema);
    if (!parsed.success)
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });

    const { id } = await params;
    const db = await getDb();
    const scope = await resolveScope(db, id);
    if (!scope) return NextResponse.json({ error: "Bill not found" }, { status: 404 });

    return NextResponse.json(
      await createBillDiscussion(db, {
        scope,
        character: auth.user.character,
        content: parsed.data.content,
      })
    );
  } catch (error) {
    return handleRouteError(error);
  }
}
