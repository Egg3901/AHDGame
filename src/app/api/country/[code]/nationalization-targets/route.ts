// GET /api/country/[code]/nationalization-targets
// Eligible whole-corp executive nationalization targets (NPC-owned or distressed
// player corps HQ'd in this country) for the Nationalize wizard. Read-only; the
// executive nationalize route enforces authority + recomputes at execution.
// Auth: requireHumanSession + isSittingLeader (head of government)
// Errors: 400, 401, 403, 429
import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { requireHumanSession } from "@/lib/api/requireAuth";
import { handleRouteError } from "@/lib/api/errors";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { COUNTRY_CURRENCY_MAP, type CurrencyCode } from "@/lib/constants/currencies";
import type { Corporation } from "@/lib/db/types";
import { getCharacterByUserId } from "@/lib/db/characterLookup";
import { getCurrentTurn } from "@/lib/turn/currentTurn";
import { isSittingLeader } from "@/lib/governorOffice/isSittingLeader";
import { isStateOwned } from "@/lib/nationalization/nationalCorporation";
import { resolveCorpEligibilityBatch } from "@/lib/nationalization/targetEligibility";

interface RouteParams {
  params: Promise<{ code: string }>;
}

export async function GET(request: Request, { params }: RouteParams) {
  try {
    const auth = await requireHumanSession(request);
    if (!auth.ok) return auth.response;

    const rateLimit = checkRateLimit(auth.user.userId, 30, 60000);
    if (!rateLimit.ok) return rateLimitResponse(rateLimit.retryAfter);

    const { code } = await params;
    const countryId = code.toUpperCase() as CountryId;
    if (!COUNTRY_CONFIGS[countryId]) {
      return NextResponse.json({ error: "Invalid country code" }, { status: 400 });
    }

    const db = await getDb();
    const character = await getCharacterByUserId(db, auth.user.userId);
    if (!character || !(await isSittingLeader(db, countryId, character._id))) {
      return NextResponse.json(
        { error: "Only the head of government may view nationalization targets." },
        { status: 403 }
      );
    }

    const currentTurn = await getCurrentTurn(db);
    const fallbackCurrency = (COUNTRY_CURRENCY_MAP[countryId] ?? "USD") as CurrencyCode;

    // Candidate pool: corps HQ'd here that are not already state-owned.
    const candidates = await db
      .collection<Corporation>("corporations")
      .find({ countryId, countryOwnerId: { $exists: false } })
      .toArray();

    const targets: Array<{
      corporationId: string;
      name: string;
      ownerKind: "player" | "npc";
      triggers: string[];
      sectorCount: number;
      marketCapLocal: number;
      liquidCapitalLocal: number;
      currency: CurrencyCode;
    }> = [];

    // Batched eligibility: fixed number of queries for the whole candidate
    // pool (defaulted bonds, sectors, designated types, market share) instead
    // of O(corps × sectors) per-corp round-trips.
    const notStateOwned = candidates.filter((corp) => !isStateOwned(corp));
    const eligibilityByCorpId = await resolveCorpEligibilityBatch(
      db,
      countryId,
      notStateOwned,
      currentTurn
    );

    for (const corp of notStateOwned) {
      const elig = eligibilityByCorpId.get(String(corp._id));
      if (!elig || !elig.executivelyTakeable || !elig.result.eligible) continue;
      targets.push({
        corporationId: String(corp._id),
        name: corp.name,
        ownerKind: elig.ownerKind,
        triggers: elig.result.triggers,
        sectorCount: elig.sectorCount,
        marketCapLocal: Math.max(0, (corp.sharePrice ?? 0) * (corp.totalShares ?? 0)),
        liquidCapitalLocal: Math.max(0, corp.liquidCapital ?? 0),
        currency: (corp.liquidCurrencyCode ?? fallbackCurrency) as CurrencyCode,
      });
    }

    targets.sort((a, b) => a.name.localeCompare(b.name));
    return NextResponse.json({ targets });
  } catch (error) {
    return handleRouteError(error);
  }
}
