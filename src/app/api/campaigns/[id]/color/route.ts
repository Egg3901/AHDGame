import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { z } from "zod";
import { getDb } from "@/lib/mongodb";
import { requireAuthWithCharacter } from "@/lib/api/requireAuth";
import { parseJsonBody } from "@/lib/api/validate";
import { handleRouteError } from "@/lib/api/errors";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
import { setCampaignColor } from "@/lib/campaigns/commands/campaignCommands";

const HEX_RE = /^#[0-9A-Fa-f]{6}$/;
const schema = z.object({
  color: z.union([
    z.string().regex(HEX_RE, { message: "Color must be a 6-digit hex (#RRGGBB)" }),
    z.null(),
  ]),
});

interface RouteParams {
  params: Promise<{ id: string }>;
}

// POST /api/campaigns/[id]/color — Set the campaign display color shown on primary maps and candidate tiles. Null clears to the party default.
// Auth: requireAuthWithCharacter (candidate owns the character, campaign manager, or admin)
// Errors: 400, 401, 403, 404, 429
export async function POST(request: Request, { params }: RouteParams) {
  try {
    const { id } = await params;
    if (!ObjectId.isValid(id)) {
      return NextResponse.json({ error: "Invalid campaign ID" }, { status: 400 });
    }

    const auth = await requireAuthWithCharacter();
    if (!auth.ok) return auth.response;

    const rate = checkRateLimit(auth.user.userId, 10, 60000);
    if (!rate.ok) return rateLimitResponse(rate.retryAfter);

    const parsed = await parseJsonBody(request, schema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }
    const { color } = parsed.data;

    const db = await getDb();
    const result = await setCampaignColor({
      db,
      campaignId: new ObjectId(id),
      user: auth.user,
      color,
    });
    return NextResponse.json({
      success: true,
      ...result,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
