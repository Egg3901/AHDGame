import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { z } from "zod";
import { getDb } from "@/lib/mongodb";
import { requireAuthWithCharacter } from "@/lib/api/requireAuth";
import { handleRouteError } from "@/lib/api/errors";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
import { contributeCampaignStrength } from "@/lib/campaigns/commands/campaignCommands";
import { CAMPAIGN_STRENGTH_MAX_BATCH_CLICKS } from "@/lib/campaigns/campaignStrength";

interface RouteParams {
  params: Promise<{ id: string }>;
}

const bodySchema = z.object({
  clicks: z
    .union([z.number().int().min(1).max(CAMPAIGN_STRENGTH_MAX_BATCH_CLICKS), z.literal("max")])
    .optional(),
});

/**
 * Read the optional `{ clicks }` body.
 *
 * Not `parseJsonBody`: this route shipped with an empty-bodied POST and the
 * campaign-page CampaignStrengthPanel still sends one, so an absent or empty
 * body has to mean "one click" rather than the 400 that helper returns for
 * unparseable JSON. A body that IS present is still schema-validated.
 */
async function parseClicks(
  request: Request
): Promise<{ ok: true; clicks: number | "max" | undefined } | { ok: false; error: string }> {
  let text: string;
  try {
    text = await request.text();
  } catch {
    return { ok: false, error: "Invalid request body" };
  }
  if (text.trim() === "") return { ok: true, clicks: undefined };

  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, error: "Invalid JSON body" };
  }
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      error: `clicks must be an integer 1-${CAMPAIGN_STRENGTH_MAX_BATCH_CLICKS} or "max"`,
    };
  }
  return { ok: true, clicks: parsed.data.clicks };
}

// POST /api/campaigns/[id]/campaign-strength — Contribute campaign strength to a presidential campaign.
// Body (optional): { clicks?: 1..100 | "max" }: bundle N single contributions into one charge. Defaults to 1.
// Auth: requireAuthWithCharacter
// Errors: 400, 401, 403, 404, 429
export async function POST(request: Request, { params }: RouteParams) {
  try {
    const { id: campaignId } = await params;

    if (!ObjectId.isValid(campaignId)) {
      return NextResponse.json({ error: "Invalid campaign ID" }, { status: 400 });
    }

    const auth = await requireAuthWithCharacter();
    if (!auth.ok) return auth.response;

    const rateLimit = checkRateLimit(auth.user.userId, 20, 60000);
    if (!rateLimit.ok) return rateLimitResponse(rateLimit.retryAfter);

    const body = await parseClicks(request);
    if (!body.ok) return NextResponse.json({ error: body.error }, { status: 400 });

    const db = await getDb();
    const result = await contributeCampaignStrength({
      db,
      campaignId: new ObjectId(campaignId),
      user: auth.user,
      clicks: body.clicks,
    });
    return NextResponse.json({
      success: true,
      ...result,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
