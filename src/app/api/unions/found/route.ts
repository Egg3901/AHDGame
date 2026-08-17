/**
 * POST /api/unions/found: found a rival union in an industry, seeding the
 * raid target `organizeSector` needs. Gated on `labourSystemMode >= "full"`.
 * See `foundUnion` in `@/lib/unions/commands/foundUnion` for cost/validation.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/mongodb";
import { parseJsonBody } from "@/lib/api/validate";
import { requireBasicAuth } from "@/lib/api/requireAuth";
import { handleRouteError } from "@/lib/api/errors";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
import { getCharacterByUserId } from "@/lib/db/characterLookup";
import { isLabourFullMode } from "@/lib/labour/featureFlag";
import { CORPORATION_TYPES } from "@/lib/constants/corporations";
import { countryIdSchema } from "@/lib/api/schemas/country";
import { containsBlockedName } from "@/lib/moderation";
import {
  foundUnion,
  MAX_UNION_NAME_LENGTH,
  MIN_UNION_NAME_LENGTH,
} from "@/lib/unions/commands/foundUnion";

const foundUnionSchema = z.object({
  countryId: countryIdSchema,
  sectorType: z.enum(CORPORATION_TYPES),
  name: z
    .string()
    .trim()
    .min(MIN_UNION_NAME_LENGTH, `Union name must be at least ${MIN_UNION_NAME_LENGTH} characters`)
    .max(MAX_UNION_NAME_LENGTH, `Union name must be ${MAX_UNION_NAME_LENGTH} characters or less`)
    .refine((value) => !containsBlockedName(value), {
      message: "Union name contains prohibited language",
    }),
});

export async function POST(request: Request) {
  try {
    const auth = await requireBasicAuth();
    if (!auth.ok) return auth.response;

    if (!(await isLabourFullMode())) {
      return NextResponse.json({ error: "Player-run unions are not enabled." }, { status: 403 });
    }

    const rateLimit = checkRateLimit(auth.user.userId, 20, 60000);
    if (!rateLimit.ok) return rateLimitResponse(rateLimit.retryAfter);

    const parsed = await parseJsonBody(request, foundUnionSchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }

    const db = await getDb();
    const character = await getCharacterByUserId(db, auth.user.userId);
    if (!character) {
      return NextResponse.json({ error: "Character not found" }, { status: 404 });
    }

    const result = await foundUnion(db, character, parsed.data);
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }
    const { ok: _ok, status: _status, ...payload } = result;
    return NextResponse.json({ success: true, ...payload }, { status: 201 });
    // Note: 201 (Created) rather than `result.status` (200, the shared
    // UnionActionResult convention for a mutation on an existing union), this
    // route is the one place under src/app/api/unions that creates a new
    // resource rather than mutating one.
  } catch (error) {
    return handleRouteError(error);
  }
}
