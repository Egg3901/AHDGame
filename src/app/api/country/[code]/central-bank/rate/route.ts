// POST /api/country/[code]/central-bank/rate - Adjust the prime rate for a country central bank.
// Auth: requireAuth
// Errors: 400, 403, 404, 409, 429
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth } from "@/lib/api/requireAuth";
import { parseJsonBody } from "@/lib/api/validate";
import { handleRouteError, notFound } from "@/lib/api/errors";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
import { sendMultiCountryGameEvent } from "@/lib/discordWebhooks";
import { buildPrimeRateChangeEmbed } from "@/lib/centralBankWebhook";
import { getBankId, getConfiguredSharedBankMemberCountries } from "@/lib/centralBank/helpers";
import { getGameState } from "@/lib/gameState";
import { getDb } from "@/lib/mongodb";
import { updatePrimeRate } from "@/lib/monetaryPolicy/commands/updatePrimeRate";
import { PRIME_RATE_STEP } from "@/lib/db/types/centralBank";

interface RouteContext {
  params: Promise<{ code: string }>;
}

const schema = z.object({
  rate: z
    .number()
    .min(0, "Rate must be at least 0%")
    .max(25, "Rate must be at most 25%")
    .multipleOf(PRIME_RATE_STEP, `Rate must be in ${PRIME_RATE_STEP}% increments`),
  reason: z.string().max(200, "Reason must be at most 200 characters").optional(),
});

export async function POST(request: Request, context: RouteContext) {
  try {
    const auth = await requireAuth();
    if (!auth.ok) return auth.response;

    const rateLimit = checkRateLimit(auth.user.userId, 10, 60000);
    if (!rateLimit.ok) return rateLimitResponse(rateLimit.retryAfter);

    const { code } = await context.params;
    const countryId = code.toUpperCase() as CountryId;
    if (!COUNTRY_CONFIGS[countryId]) {
      return NextResponse.json(notFound("Country not found").toJson(), { status: 404 });
    }

    const parsed = await parseJsonBody(request, schema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }

    const db = await getDb();
    const gameState = await getGameState();
    const result = await updatePrimeRate({
      db,
      countryId,
      actor: {
        userId: auth.user.userId,
        username: auth.user.username,
        isAdmin: auth.user.isAdmin === true,
        character: auth.user.character ?? null,
      },
      rate: parsed.data.rate,
      reason: parsed.data.reason,
      currentTurn: gameState?.currentTurn ?? 0,
      currentYear: gameState?.currentYear,
    });

    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }

    // Shared central banks have one prime rate that applies to every member country
    // (ECB → DE + IE). Posting only to the URL's country would silently drop the
    // sibling members' webhooks for a rate that materially affects them too.
    const sharedMembers = getConfiguredSharedBankMemberCountries(getBankId(countryId));
    const recipients = sharedMembers.length > 0 ? sharedMembers : [countryId];
    sendMultiCountryGameEvent(
      recipients,
      buildPrimeRateChangeEmbed({
        countryId,
        previousRate: result.previousRate,
        newRate: result.primeRate,
        changedByName: result.changedByName,
        reason: result.reason,
        scrutinyApplied: result.scrutinyApplied,
      })
    ).catch(() => {});

    return NextResponse.json({
      success: true,
      primeRate: result.primeRate,
      scrutinyApplied: result.scrutinyApplied,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
