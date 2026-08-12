// GET/POST /api/country/[code]/central-bank/fx-regime — the chair declares the
// exchange-rate regime and the capital account (B6).
// Auth: requireAuthWithCharacter, seated chair (or admin)
// Errors: 400, 401, 403, 404, 429

import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/mongodb";
import { requireAuthWithCharacter } from "@/lib/api/requireAuth";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
import { handleRouteError, forbidden, notFound } from "@/lib/api/errors";
import { parseJsonBody } from "@/lib/api/validate";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import type { CentralBank } from "@/lib/db/types/centralBank";
import type { ExchangeRate } from "@/lib/db/types/exchangeRate";
import { getBankId } from "@/lib/centralBank/helpers";
import { getCurrentTurn } from "@/lib/turn/currentTurn";
import { recordAudit } from "@/lib/audit/recordAudit";
import { createSystemNewsPost } from "@/lib/news";
import { describeTrinity, resolveTrinity, type FxRegime } from "@/lib/currency/exchangeRateRegime";

interface RouteContext {
  params: Promise<{ code: string }>;
}

const schema = z.object({
  regime: z.enum(["float", "band", "peg"]),
  capitalControls: z.boolean(),
  /** Required when declaring a peg. */
  pegTarget: z.number().positive().optional(),
});

/** Turns between regime changes. A regime nobody believes is not a regime. */
export const FX_REGIME_COOLDOWN_TURNS = 48;

export async function GET(_request: Request, context: RouteContext) {
  try {
    const auth = await requireAuthWithCharacter();
    if (!auth.ok) return auth.response;

    const { code } = await context.params;
    const countryId = code.toUpperCase() as CountryId;
    if (!COUNTRY_CONFIGS[countryId])
      return NextResponse.json(notFound("Country not found").toJson(), { status: 404 });

    const db = await getDb();
    const fx = await db.collection<ExchangeRate>("exchangeRates").findOne({ countryId });
    const regime: FxRegime = fx?.fxRegime ?? (fx?.interventionPolicy ? "band" : "float");
    const capitalControls = fx?.capitalControls === true;
    const trinity = resolveTrinity(regime, capitalControls);

    return NextResponse.json({
      regime,
      capitalControls,
      pegTarget: fx?.pegTarget ?? null,
      trinity,
      summary: describeTrinity(trinity),
      changeableFromTurn: (fx?.fxRegimeSetAtTurn ?? 0) + FX_REGIME_COOLDOWN_TURNS,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function POST(request: Request, context: RouteContext) {
  try {
    const auth = await requireAuthWithCharacter();
    if (!auth.ok) return auth.response;

    const rateLimit = checkRateLimit(`fx-regime:${auth.user.userId}`, 5, 60000);
    if (!rateLimit.ok) return rateLimitResponse(rateLimit.retryAfter);

    const { code } = await context.params;
    const countryId = code.toUpperCase() as CountryId;
    const config = COUNTRY_CONFIGS[countryId];
    if (!config) return NextResponse.json(notFound("Country not found").toJson(), { status: 404 });

    const db = await getDb();
    const bank = await db
      .collection<CentralBank>("centralBanks")
      .findOne({ _id: getBankId(countryId) }, { projection: { chairCharacterId: 1 } });
    if (!bank)
      return NextResponse.json(notFound("Central bank not found").toJson(), { status: 404 });

    if (
      !bank.chairCharacterId ||
      bank.chairCharacterId.toString() !== auth.user.character._id.toString()
    )
      return NextResponse.json(
        forbidden(
          `Only the ${config.centralBank.chairTitle} can set the exchange-rate regime.`
        ).toJson(),
        { status: 403 }
      );

    const parsed = await parseJsonBody(request, schema);
    if (!parsed.success)
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    const { regime, capitalControls, pegTarget } = parsed.data;

    if (regime === "peg" && !(pegTarget && pegTarget > 0))
      return NextResponse.json({ error: "A peg needs a target rate." }, { status: 400 });

    const fx = await db.collection<ExchangeRate>("exchangeRates").findOne({ countryId });
    if (!fx)
      return NextResponse.json(notFound("No exchange rate for this country").toJson(), {
        status: 404,
      });

    const turn = await getCurrentTurn(db);
    const since = fx.fxRegimeSetAtTurn ?? -Infinity;
    if (turn - since < FX_REGIME_COOLDOWN_TURNS) {
      const wait = FX_REGIME_COOLDOWN_TURNS - (turn - since);
      return NextResponse.json(
        {
          error: `A regime nobody believes is not a regime. ${Math.ceil(wait)} more turn(s) before it can be changed again.`,
        },
        { status: 409 }
      );
    }

    await db.collection<ExchangeRate>("exchangeRates").updateOne(
      { countryId },
      {
        $set: {
          fxRegime: regime,
          capitalControls,
          pegTarget: regime === "peg" ? pegTarget : null,
          fxRegimeSetAtTurn: turn,
          updatedAt: new Date(),
        },
        // Declaring a float cancels any standing band: they are contradictory
        // promises, and leaving the band behind would keep the trinity binding
        // against a commitment the chair just withdrew.
        ...(regime === "float" ? { $unset: { interventionPolicy: "" } } : {}),
      }
    );

    const trinity = resolveTrinity(regime, capitalControls);
    createSystemNewsPost(
      `The ${config.centralBank.name} declared a ${regime === "float" ? "floating" : regime === "peg" ? "pegged" : "banded"} exchange rate${capitalControls ? " with capital controls" : ""}. ${describeTrinity(trinity)}`,
      "legislation"
    ).catch(() => {});

    recordAudit({
      source: "api",
      action: "centralBank.fxRegime.set",
      category: "money",
      turn,
      ts: new Date(),
      subject: { type: "character", id: auth.user.character._id, name: auth.user.character.name },
      outcome: "ok",
      meta: { countryId, regime, capitalControls, pegTarget: pegTarget ?? null },
    });

    return NextResponse.json({
      success: true,
      regime,
      capitalControls,
      trinity,
      summary: describeTrinity(trinity),
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
