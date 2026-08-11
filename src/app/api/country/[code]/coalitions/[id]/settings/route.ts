import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/mongodb";
import { requireAuthWithCharacter } from "@/lib/api/requireAuth";
import { parseJsonBody } from "@/lib/api/validate";
import { handleRouteError, badRequest, forbidden, notFound } from "@/lib/api/errors";
import type { Coalition } from "@/lib/db/types/coalition";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
import { normalizeDiscordInviteUrl } from "@/lib/discord/invite";

const settingsSchema = z.object({
  name: z.string().min(3).max(60).trim().optional(),
  abbreviation: z.string().min(2).max(10).trim().optional(),
  color: z
    .string()
    .regex(/^#[0-9A-Fa-f]{6}$/, "Must be a valid hex color")
    .optional(),
  discordInviteUrl: z.union([z.string().trim().max(200), z.null()]).optional(),
});

// PATCH /api/coalitions/[id]/settings?country= — Update coalition settings
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ code: string; id: string }> }
) {
  try {
    const { code, id } = await params;
    const countryId = code.toUpperCase() as CountryId;
    if (!COUNTRY_CONFIGS[countryId]) {
      return NextResponse.json({ error: "Invalid country code" }, { status: 400 });
    }

    const authResult = await requireAuthWithCharacter();
    if (!authResult.ok) return authResult.response;

    const rateLimit = checkRateLimit(authResult.user.userId, 20, 60000);
    if (!rateLimit.ok) return rateLimitResponse(rateLimit.retryAfter);
    const { character } = authResult.user;

    const parsed = await parseJsonBody(request, settingsSchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }

    const { name, abbreviation, color } = parsed.data;

    if (
      name === undefined &&
      abbreviation === undefined &&
      color === undefined &&
      parsed.data.discordInviteUrl === undefined
    ) {
      throw badRequest("At least one field must be provided.");
    }

    const db = await getDb();

    const coalition = await db
      .collection<Coalition>("coalitions")
      .findOne({ sequentialId: parseInt(id, 10), countryId });
    if (!coalition) {
      throw notFound("Coalition not found.");
    }

    // Caller must be the coalition chair
    if (!coalition.chairCharacterId || !coalition.chairCharacterId.equals(character._id)) {
      throw forbidden("Only the coalition chair can update settings.");
    }

    const now = new Date();
    const updates: Record<string, unknown> = { updatedAt: now };
    if (name !== undefined) updates.name = name;
    if (abbreviation !== undefined) updates.abbreviation = abbreviation;
    if (color !== undefined) updates.color = color;
    if (parsed.data.discordInviteUrl !== undefined) {
      const submittedDiscordInviteUrl = parsed.data.discordInviteUrl?.trim() ?? "";
      const normalizedDiscordInviteUrl = normalizeDiscordInviteUrl(submittedDiscordInviteUrl);
      if (submittedDiscordInviteUrl && !normalizedDiscordInviteUrl) {
        throw badRequest("Discord link must be a valid Discord invite URL.");
      }
      updates.discordInviteUrl = normalizedDiscordInviteUrl;
    }

    await db
      .collection<Coalition>("coalitions")
      .updateOne({ _id: coalition._id }, { $set: updates });

    return NextResponse.json({ success: true });
  } catch (error) {
    return handleRouteError(error);
  }
}
