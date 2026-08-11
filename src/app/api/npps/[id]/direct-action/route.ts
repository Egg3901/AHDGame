import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { z } from "zod";
import { requireAuthWithCharacter } from "@/lib/api/requireAuth";
import { parseJsonBody } from "@/lib/api/validate";
import { handleRouteError } from "@/lib/api/errors";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
import { getDb } from "@/lib/mongodb";
import {
  applyNppDirectAction,
  DirectActionBalanceConflictError,
} from "@/lib/npps/commands/directAction";
import { getNppDirectActionView } from "@/lib/npps/queries/directAction";

const bodySchema = z.object({
  action: z.enum([
    "request_endorsement",
    "private_meeting",
    "boost_favorability",
    "boost_influence",
    "reduce_favorability",
    "reduce_influence",
  ]),
  candidacyId: z
    .string()
    .regex(/^[a-f\d]{24}$/i)
    .optional(),
});

interface RouteParams {
  params: Promise<{ id: string }>;
}

// POST /api/npps/[id]/direct-action - Execute the shared player-to-NPP direct-action workflow.
// Auth: requireAuthWithCharacter
// Errors: 400, 401, 404, 409, 429
export async function POST(request: Request, { params }: RouteParams) {
  try {
    const { id } = await params;
    if (!ObjectId.isValid(id)) {
      return NextResponse.json({ error: "Invalid NPP ID" }, { status: 400 });
    }

    const auth = await requireAuthWithCharacter();
    if (!auth.ok) return auth.response;

    const rateLimit = checkRateLimit(auth.user.userId, 30, 60_000);
    if (!rateLimit.ok) return rateLimitResponse(rateLimit.retryAfter);

    const parsed = await parseJsonBody(request, bodySchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }

    const db = await getDb();
    const result = await applyNppDirectAction(db, {
      nppId: new ObjectId(id),
      characterId: auth.user.character._id,
      actorParty: auth.user.character.party,
      action: parsed.data.action,
      candidacyId: parsed.data.candidacyId,
    });

    if ("error" in result) {
      return NextResponse.json(
        {
          error: result.error,
          ...(result.failure ? { failure: result.failure } : {}),
        },
        { status: result.status }
      );
    }

    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof DirectActionBalanceConflictError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    return handleRouteError(error);
  }
}

// GET /api/npps/[id]/direct-action - Return the shared NPP interaction menu payload.
// Auth: requireAuthWithCharacter
// Errors: 400, 401, 404
export async function GET(_request: Request, { params }: RouteParams) {
  try {
    const { id } = await params;
    if (!ObjectId.isValid(id)) {
      return NextResponse.json({ error: "Invalid NPP ID" }, { status: 400 });
    }

    const auth = await requireAuthWithCharacter();
    if (!auth.ok) return auth.response;

    const db = await getDb();
    const result = await getNppDirectActionView(db, {
      characterId: auth.user.character._id,
      nppId: new ObjectId(id),
    });
    if ("error" in result) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }

    return NextResponse.json(result);
  } catch (error) {
    return handleRouteError(error);
  }
}
