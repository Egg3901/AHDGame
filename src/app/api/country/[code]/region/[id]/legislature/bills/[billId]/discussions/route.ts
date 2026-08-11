import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { z } from "zod";
import { getDb } from "@/lib/mongodb";
import { getAuthUserWithCharacter } from "@/lib/auth";
import { requireAuthWithCharacter } from "@/lib/api/requireAuth";
import { handleRouteError } from "@/lib/api/errors";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
import { parseJsonBody } from "@/lib/api/validate";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { createBillDiscussion } from "@/lib/legislature/discussions/discussionCommands";
import { getBillDiscussionsForViewer } from "@/lib/legislature/discussions/discussionQueries";
import type { BillDiscussionScope } from "@/lib/legislature/discussions/types";
import type { StateBill } from "@/lib/db/types";

const createSchema = z.object({ content: z.string().min(1).max(1000).trim() });

type ScopeResult = { scope: BillDiscussionScope } | { error: string; status: number };

async function resolveScope(
  db: Awaited<ReturnType<typeof getDb>>,
  code: string,
  regionId: string,
  billId: string
): Promise<ScopeResult> {
  const countryId = code.toUpperCase() as CountryId;
  if (!COUNTRY_CONFIGS[countryId]) return { error: "Invalid country code", status: 400 };
  if (!ObjectId.isValid(billId)) return { error: "Invalid bill id", status: 400 };
  const stateId = regionId.toUpperCase();

  // Existence + region match (matches the vote route's `{ _id, stateId }` filter so
  // legacy docs without `countryId` still resolve). Soft cross-country guard below.
  const bill = await db
    .collection<StateBill>("stateBills")
    .findOne({ _id: new ObjectId(billId), stateId });
  if (!bill) return { error: "Bill not found", status: 404 };
  if (bill.countryId && bill.countryId !== countryId) {
    return { error: "Bill not found", status: 404 };
  }

  return { scope: { kind: "state", countryId, stateId, billId } };
}

// GET …/discussions — Paginated state-bill discussions (newest first, 10/page).
// Auth: public (viewer fields populated when logged in)
// Errors: 400, 404
export async function GET(
  request: Request,
  { params }: { params: Promise<{ code: string; id: string; billId: string }> }
) {
  try {
    const { code, id, billId } = await params;
    const db = await getDb();
    const resolved = await resolveScope(db, code, id, billId);
    if ("error" in resolved) {
      return NextResponse.json({ error: resolved.error }, { status: resolved.status });
    }

    const page = Number(new URL(request.url).searchParams.get("page") ?? "1");
    const user = await getAuthUserWithCharacter().catch(() => null);
    return NextResponse.json(await getBillDiscussionsForViewer(db, resolved.scope, { user, page }));
  } catch (error) {
    return handleRouteError(error);
  }
}

// POST …/discussions — Post a discussion (regional legislators only).
// Auth: requireAuthWithCharacter
// Errors: 400, 401, 403, 404, 429
export async function POST(
  request: Request,
  { params }: { params: Promise<{ code: string; id: string; billId: string }> }
) {
  try {
    const auth = await requireAuthWithCharacter();
    if (!auth.ok) return auth.response;

    const rateLimit = checkRateLimit(auth.user.userId, 20, 60000);
    if (!rateLimit.ok) return rateLimitResponse(rateLimit.retryAfter);

    const parsed = await parseJsonBody(request, createSchema);
    if (!parsed.success)
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });

    const { code, id, billId } = await params;
    const db = await getDb();
    const resolved = await resolveScope(db, code, id, billId);
    if ("error" in resolved) {
      return NextResponse.json({ error: resolved.error }, { status: resolved.status });
    }

    return NextResponse.json(
      await createBillDiscussion(db, {
        scope: resolved.scope,
        character: auth.user.character,
        content: parsed.data.content,
      })
    );
  } catch (error) {
    return handleRouteError(error);
  }
}
