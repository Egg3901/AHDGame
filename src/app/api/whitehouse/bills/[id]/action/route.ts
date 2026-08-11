/**
 * POST /api/whitehouse/bills/[id]/action — President signs or vetoes a bill
 */
import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { requireAuth } from "@/lib/api/requireAuth";
import { parseObjectId } from "@/lib/utils/objectId";
import { parseJsonBody } from "@/lib/api/validate";
import { handleRouteError } from "@/lib/api/errors";
import { CONGRESS_LIMITS, checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
import { executePresidentialBillAction } from "@/lib/presidentialBillAction";
import { z } from "zod";
import type { Bill, ElectedOfficial } from "@/lib/db/types";
import { VETO_MESSAGE_MIN_LENGTH, VETO_MESSAGE_MAX_LENGTH } from "@/lib/constants/governorOffice";

const actionSchema = z
  .object({
    decision: z.enum(["sign", "veto"]),
    vetoMessage: z.string().min(VETO_MESSAGE_MIN_LENGTH).max(VETO_MESSAGE_MAX_LENGTH).optional(),
  })
  .refine(
    (data) =>
      data.decision !== "veto" || (data.vetoMessage?.trim().length ?? 0) >= VETO_MESSAGE_MIN_LENGTH,
    {
      message: `A veto requires a public message of at least ${VETO_MESSAGE_MIN_LENGTH} characters.`,
    }
  );

// POST /api/whitehouse/bills/[id]/action — President signs or vetoes an enrolled bill.
// Auth: requireAuth
// Errors: 400, 401, 403, 404, 409, 429
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const billOid = parseObjectId(id);
    if (!billOid) {
      return NextResponse.json({ error: "Invalid bill ID" }, { status: 400 });
    }

    const auth = await requireAuth();
    if (!auth.ok) return auth.response;

    const limit = checkRateLimit(
      `congress:${auth.user.userId}`,
      CONGRESS_LIMITS.maxRequests,
      CONGRESS_LIMITS.windowMs
    );
    if (!limit.ok) return rateLimitResponse(limit.retryAfter);

    const parsed = await parseJsonBody(request, actionSchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }
    const { decision, vetoMessage } = parsed.data;

    const db = await getDb();

    // Scope the president check to the bill's own country so the route works
    // for any presidential country (legacy US bills may lack countryId).
    const bill = await db
      .collection<Bill>("bills")
      .findOne({ _id: billOid }, { projection: { countryId: 1 } });
    if (!bill) {
      return NextResponse.json({ error: "Bill not found" }, { status: 404 });
    }
    const billCountryId = bill.countryId ?? "US";

    const presidentOfficial = await db
      .collection<ElectedOfficial>("electedOfficials")
      .findOne({ officeType: "president", countryId: billCountryId, characterId: { $ne: null } });
    if (!presidentOfficial?.characterId) {
      return NextResponse.json({ error: "No President in office" }, { status: 400 });
    }

    const myCharacter = auth.user.character;
    if (!myCharacter || !presidentOfficial.characterId.equals(myCharacter._id)) {
      return NextResponse.json(
        { error: "Only the President can sign or veto bills" },
        { status: 403 }
      );
    }

    const result = await executePresidentialBillAction(
      db,
      billOid,
      myCharacter._id,
      decision,
      vetoMessage
    );

    if (!result.success) {
      const status = result.error === "Bill not found" ? 404 : 409;
      return NextResponse.json({ error: result.error }, { status });
    }

    return NextResponse.json({ success: true, message: result.message });
  } catch (error) {
    return handleRouteError(error);
  }
}
