// PATCH /api/country/[code]/parties/[id]/settings - Update chair-managed party settings such as color and Discord invite link
// Auth: requireAuth
// Errors: 400, 401, 403, 404, 429
/**
 * PATCH /api/parties/[id]/settings
 *
 * Allows the party Chair to update party settings like color and Discord invite link.
 */
import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { requireAuth } from "@/lib/api/requireAuth";
import { parseJsonBody } from "@/lib/api/validate";
import { handleRouteError, forbidden, notFound } from "@/lib/api/errors";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
import { findPartyBySequentialId } from "@/lib/db/partyLookup";
import { z } from "zod";
import type { PoliticalParty } from "@/lib/db/types";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { normalizeDiscordInviteUrl } from "@/lib/discord/invite";
import { canActAsChair } from "@/lib/parties/actingChair";

const updateSchema = z.object({
  color: z
    .string()
    .regex(/^#[0-9A-Fa-f]{6}$/, "Color must be a valid hex color (e.g., #FF5733)")
    .optional(),
  discordInviteUrl: z.union([z.string().trim().max(200), z.null()]).optional(),
  // Membership gate (suggestion #72): "open" = immediate joins, "approval" =
  // joins file a pending request for a leader to accept/decline.
  membershipMode: z.enum(["open", "approval"]).optional(),
});

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ code: string; id: string }> }
) {
  try {
    const { code, id: partyId } = await params;
    const countryId = code.toUpperCase() as CountryId;
    if (!COUNTRY_CONFIGS[countryId]) {
      return NextResponse.json({ error: "Invalid country code" }, { status: 400 });
    }

    const authResult = await requireAuth();
    if (!authResult.ok) return authResult.response;
    const authUser = authResult.user;

    const rateLimit = checkRateLimit(authUser.userId, 30, 60000);
    if (!rateLimit.ok) return rateLimitResponse(rateLimit.retryAfter);

    const parsed = await parseJsonBody(request, updateSchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }

    const db = await getDb();

    const character = authUser.character;
    if (!character) {
      return NextResponse.json({ error: "No character found" }, { status: 400 });
    }

    const party = await findPartyBySequentialId(db, partyId, countryId);
    if (!party) {
      return NextResponse.json(notFound("Party not found").toJson(), { status: 404 });
    }

    if (!canActAsChair(party, character._id)) {
      return NextResponse.json(
        forbidden(
          "Only the party Chair (or acting Vice-Chair when the chair seat is vacant) can update settings"
        ).toJson(),
        { status: 403 }
      );
    }

    const updates: Partial<PoliticalParty> = {
      updatedAt: new Date(),
    };

    if (parsed.data.color) {
      updates.color = parsed.data.color;
    }

    if (parsed.data.discordInviteUrl !== undefined) {
      const submittedDiscordInviteUrl = parsed.data.discordInviteUrl?.trim() ?? "";
      const normalizedDiscordInviteUrl = normalizeDiscordInviteUrl(submittedDiscordInviteUrl);
      if (submittedDiscordInviteUrl && !normalizedDiscordInviteUrl) {
        return NextResponse.json(
          { error: "Discord link must be a valid Discord invite URL" },
          { status: 400 }
        );
      }
      updates.discordInviteUrl = normalizedDiscordInviteUrl;
    }

    if (parsed.data.membershipMode !== undefined) {
      updates.membershipMode = parsed.data.membershipMode;
    }

    if (Object.keys(updates).length <= 1) {
      return NextResponse.json({ error: "No valid updates provided" }, { status: 400 });
    }

    await db
      .collection<PoliticalParty>("politicalParties")
      .updateOne({ _id: party._id }, { $set: updates });

    return NextResponse.json({ success: true, message: "Party settings updated" });
  } catch (error) {
    return handleRouteError(error);
  }
}
