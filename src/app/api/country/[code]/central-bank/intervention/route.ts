// POST   /api/country/[code]/central-bank/intervention — Set a new band
// PATCH  /api/country/[code]/central-bank/intervention — Widen or narrow band (narrow gated by cooldown)
// DELETE /api/country/[code]/central-bank/intervention — Cancel active band (gated by cooldown)
// Auth: requireAuth — must be the chair for the country (admin bypass)
// Errors: 400, 403, 404

import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/mongodb";
import { requireAuth } from "@/lib/api/requireAuth";
import { parseJsonBody } from "@/lib/api/validate";
import { handleRouteError, forbidden, notFound, badRequest } from "@/lib/api/errors";
import { isSameCountry } from "@/lib/api/sameCountry";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import type { CentralBank } from "@/lib/db/types";
import type { ExchangeRate, InterventionPolicy } from "@/lib/db/types/exchangeRate";
import {
  INITIAL_RATES,
  RATE_FLOOR_MULTIPLIER,
  RATE_CEILING_MULTIPLIER,
  INTERVENTION_POLICY_COOLDOWN_TURNS,
} from "@/lib/constants/currencies";
import { getGameState } from "@/lib/gameState";
import { getBankId } from "@/lib/centralBank/helpers";

interface RouteContext {
  params: Promise<{ code: string }>;
}

const bandSchema = z.object({
  floor: z.number().positive(),
  ceiling: z.number().positive(),
});

function assertBandShape(
  body: { floor: number; ceiling: number },
  baseRate: number
): string | null {
  if (body.floor >= body.ceiling) return "Floor must be strictly less than ceiling.";
  const hardFloor = baseRate * RATE_FLOOR_MULTIPLIER;
  const hardCeiling = baseRate * RATE_CEILING_MULTIPLIER;
  if (body.floor < hardFloor || body.ceiling > hardCeiling) {
    return `Band must lie within guardrails [${hardFloor}, ${hardCeiling}].`;
  }
  return null;
}

function isSuperset(next: { floor: number; ceiling: number }, prev: InterventionPolicy): boolean {
  return next.floor <= prev.floor && next.ceiling >= prev.ceiling;
}

function isSameBand(next: { floor: number; ceiling: number }, prev: InterventionPolicy): boolean {
  return next.floor === prev.floor && next.ceiling === prev.ceiling;
}

interface GuardSuccess {
  ok: true;
  db: Awaited<ReturnType<typeof getDb>>;
  bank: CentralBank;
  rate: ExchangeRate;
  character: { _id: import("mongodb").ObjectId; name: string };
  isAdmin: boolean;
}

interface GuardFailure {
  ok: false;
  response: Response;
}

async function authorizeChair(countryId: CountryId): Promise<GuardSuccess | GuardFailure> {
  const auth = await requireAuth();
  if (!auth.ok) return { ok: false, response: auth.response };

  if (!COUNTRY_CONFIGS[countryId]) {
    return {
      ok: false,
      response: NextResponse.json(notFound("Country not found").toJson(), { status: 404 }),
    };
  }

  const db = await getDb();
  const bank = await db
    .collection<CentralBank>("centralBanks")
    .findOne({ _id: getBankId(countryId) });
  if (!bank) {
    return {
      ok: false,
      response: NextResponse.json(notFound("Central bank not found").toJson(), { status: 404 }),
    };
  }
  const rate = await db.collection<ExchangeRate>("exchangeRates").findOne({ _id: countryId });
  if (!rate) {
    return {
      ok: false,
      response: NextResponse.json(notFound("Exchange rate not found").toJson(), { status: 404 }),
    };
  }

  const myChar = auth.user.character;
  const isAdmin = auth.user.isAdmin === true;
  const isChair = !!myChar && !!bank.chairCharacterId && myChar._id.equals(bank.chairCharacterId);
  const chairLocked = bank.chairControlsLocked === true;

  // Defense-in-depth: even if the chair _id matches, refuse if the chair's
  // character somehow belongs to another country (mismatched/inconsistent data).
  if (isChair && myChar && !isSameCountry(myChar, { countryId })) {
    return {
      ok: false,
      response: NextResponse.json(forbidden("Chair must be a citizen of this country").toJson(), {
        status: 403,
      }),
    };
  }

  if (!isAdmin && !isChair) {
    return {
      ok: false,
      response: NextResponse.json(
        forbidden("Only the current chair can modify FX intervention policy").toJson(),
        { status: 403 }
      ),
    };
  }
  if (!isAdmin && chairLocked) {
    return {
      ok: false,
      response: NextResponse.json(
        forbidden("Chair controls are locked by an administrator").toJson(),
        { status: 403 }
      ),
    };
  }

  // Admin without a character can still act via bypass but we need a stand-in
  // character for audit fields. Reject here if neither; admins operating on
  // behalf of a chair should log in with a character.
  if (!myChar) {
    return {
      ok: false,
      response: NextResponse.json(forbidden("Character required").toJson(), { status: 403 }),
    };
  }

  return { ok: true, db, bank, rate, character: myChar, isAdmin };
}

export async function POST(request: Request, context: RouteContext) {
  try {
    const { code } = await context.params;
    const countryId = code.toUpperCase() as CountryId;

    const guard = await authorizeChair(countryId);
    if (!guard.ok) return guard.response;

    const parsed = await parseJsonBody(request, bandSchema);
    if (!parsed.success)
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });

    const baseRate = INITIAL_RATES[countryId];
    if (baseRate == null) throw badRequest("Forex is not active for this country");

    const shapeError = assertBandShape(parsed.data, baseRate);
    if (shapeError) throw badRequest(shapeError);

    if (guard.rate.interventionPolicy) {
      throw badRequest("A band already exists — use PATCH to adjust or DELETE to cancel.");
    }

    const gameState = await getGameState();
    const currentTurn = gameState?.currentTurn ?? 0;
    const policy: InterventionPolicy = {
      floor: parsed.data.floor,
      ceiling: parsed.data.ceiling,
      setByCharacterId: guard.character._id,
      setByCharacterName: guard.character.name,
      setAtTurn: currentTurn,
      lastAdjustedAtTurn: currentTurn,
      recentInterventions: [],
    };
    await guard.db
      .collection<ExchangeRate>("exchangeRates")
      .updateOne(
        { _id: countryId },
        { $set: { interventionPolicy: policy, updatedAt: new Date() } }
      );

    return NextResponse.json({ success: true, interventionPolicy: policy });
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const { code } = await context.params;
    const countryId = code.toUpperCase() as CountryId;

    const guard = await authorizeChair(countryId);
    if (!guard.ok) return guard.response;

    const parsed = await parseJsonBody(request, bandSchema);
    if (!parsed.success)
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });

    const baseRate = INITIAL_RATES[countryId];
    if (baseRate == null) throw badRequest("Forex is not active for this country");
    const shapeError = assertBandShape(parsed.data, baseRate);
    if (shapeError) throw badRequest(shapeError);

    const existing = guard.rate.interventionPolicy;
    if (!existing) throw badRequest("No active band — use POST to set one.");
    if (isSameBand(parsed.data, existing)) throw badRequest("Band unchanged.");

    const gameState = await getGameState();
    const currentTurn = gameState?.currentTurn ?? 0;
    const isWiden = isSuperset(parsed.data, existing) && !isSameBand(parsed.data, existing);

    if (!isWiden && !guard.isAdmin) {
      const turnsSince = currentTurn - existing.lastAdjustedAtTurn;
      if (turnsSince < INTERVENTION_POLICY_COOLDOWN_TURNS) {
        throw badRequest(
          `Narrowing the band is limited to once every ${INTERVENTION_POLICY_COOLDOWN_TURNS} turns (${INTERVENTION_POLICY_COOLDOWN_TURNS - turnsSince} more to wait).`
        );
      }
    }

    const next: InterventionPolicy = {
      ...existing,
      floor: parsed.data.floor,
      ceiling: parsed.data.ceiling,
      lastAdjustedAtTurn: isWiden ? existing.lastAdjustedAtTurn : currentTurn,
    };
    await guard.db
      .collection<ExchangeRate>("exchangeRates")
      .updateOne({ _id: countryId }, { $set: { interventionPolicy: next, updatedAt: new Date() } });

    return NextResponse.json({
      success: true,
      interventionPolicy: next,
      action: isWiden ? "widen" : "narrow",
    });
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function DELETE(_request: Request, context: RouteContext) {
  try {
    const { code } = await context.params;
    const countryId = code.toUpperCase() as CountryId;

    const guard = await authorizeChair(countryId);
    if (!guard.ok) return guard.response;

    const existing = guard.rate.interventionPolicy;
    if (!existing) throw badRequest("No active band to cancel.");

    if (!guard.isAdmin) {
      const gameState = await getGameState();
      const currentTurn = gameState?.currentTurn ?? 0;
      const turnsSince = currentTurn - existing.lastAdjustedAtTurn;
      if (turnsSince < INTERVENTION_POLICY_COOLDOWN_TURNS) {
        throw badRequest(
          `Cancelling the band is limited to once every ${INTERVENTION_POLICY_COOLDOWN_TURNS} turns (${INTERVENTION_POLICY_COOLDOWN_TURNS - turnsSince} more to wait).`
        );
      }
    }

    await guard.db
      .collection<ExchangeRate>("exchangeRates")
      .updateOne({ _id: countryId }, { $set: { interventionPolicy: null, updatedAt: new Date() } });

    return NextResponse.json({ success: true });
  } catch (error) {
    return handleRouteError(error);
  }
}
