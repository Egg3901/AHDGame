// POST /api/country/[code]/central-bank/rate - Adjust the prime rate for a country central bank.
// Auth: requireAuth
// Errors: 400, 403, 404, 409, 429
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth } from "@/lib/api/requireAuth";
import { parseJsonBody } from "@/lib/api/validate";
import { conflict, handleRouteError, notFound } from "@/lib/api/errors";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { COMMAND_CEILING, scheduledMarketizationLevel } from "@/lib/constants/commandEconomy";
import { getNationalBudgetId } from "@/lib/bonds/sovereign";
import type { FederalBudget } from "@/lib/db/types/budget";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
import { sendMultiCountryGameEvent } from "@/lib/discordWebhooks";
import { buildPrimeRateChangeEmbed } from "@/lib/centralBankWebhook";
import { getBankId, getConfiguredSharedBankMemberCountries } from "@/lib/centralBank/helpers";
import { getGameState } from "@/lib/gameState";
import { getDb } from "@/lib/mongodb";
import type { GameConfig } from "@/lib/db/types";
import { updatePrimeRate } from "@/lib/monetaryPolicy/commands/updatePrimeRate";

interface RouteContext {
  params: Promise<{ code: string }>;
}

const schema = z.object({
  rate: z
    .number()
    .min(0, "Rate must be at least 0%")
    .max(25, "Rate must be at most 25%")
    .multipleOf(0.25, "Rate must be in 0.25% increments"),
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
    // Passive monobank: command economies do not set an independent policy rate.
    // Fail-safe — flag off → unchanged. Intorg rate POSTs delegate here too.
    const gameConfig = await db
      .collection<GameConfig>("gameConfig")
      .findOne({ _id: "default" }, { projection: { commandEconomyEnabled: 1 } });
    const commandEconomyEnabled = gameConfig?.commandEconomyEnabled === true;
    // P1 read-path seam: the stored-marketization registry is process-local (only
    // the turn engine hydrates it), so this API process must resolve the level
    // from the PERSISTED economicFactors.marketizationLevel — otherwise an
    // endogenously-marketized country would be judged by the stale era schedule.
    const rateBudget = commandEconomyEnabled
      ? await db
          .collection<FederalBudget>("federalBudget")
          .findOne({ _id: getNationalBudgetId(countryId) } as { _id: "federal" }, {
            projection: { "economicFactors.marketizationLevel": 1 },
          })
      : null;
    const persistedLevel = rateBudget?.economicFactors?.marketizationLevel;
    const resolvedLevel =
      typeof persistedLevel === "number" && Number.isFinite(persistedLevel)
        ? persistedLevel
        : scheduledMarketizationLevel(countryId, gameState?.currentYear);
    if (commandEconomyEnabled && resolvedLevel < COMMAND_CEILING) {
      return NextResponse.json(
        conflict(
          "This country runs a command economy; the central bank does not set an independent policy rate."
        ).toJson(),
        { status: 409 }
      );
    }

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
