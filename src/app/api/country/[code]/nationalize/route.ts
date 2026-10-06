// POST /api/country/[code]/nationalize — Executive (emergency) nationalization of an asset
// Auth: requireHumanSession (bot tokens rejected); must be the sitting head of government
// Errors: 400, 401, 403, 429
/**
 * POST /api/country/[code]/nationalize
 * Head-of-government emergency nationalization. Executive reach is limited to
 * NPC/unowned assets and *distressed* player corps (spec §8); a solvent player
 * corp requires the legislative path (P3). Tiers are discounted/seizure only —
 * the fair-value buyout is legislative. Absorbs into the country's single
 * National Corporation.
 */
import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { requireHumanSession } from "@/lib/api/requireAuth";
import { parseJsonBody } from "@/lib/api/validate";
import { handleRouteError, errorResponse } from "@/lib/api/errors";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import type { Corporation, CorporateSector } from "@/lib/db/types";
import { getCharacterByUserId } from "@/lib/db/characterLookup";
import { getCurrentTurn } from "@/lib/turn/currentTurn";
import { isSittingLeader } from "@/lib/governorOffice/isSittingLeader";
import { executiveNationalizeSchema } from "@/lib/api/schemas/nationalization";
import { resolveCorpEligibility } from "@/lib/nationalization/targetEligibility";
import { nationalizeSector, nationalizeWholeCorp } from "@/lib/nationalization/ownershipTransition";
import { isStateOwned } from "@/lib/nationalization/nationalCorporation";
import { isWithinRenationalizeCooldown } from "@/lib/nationalization/privatizationShares";
import { generateStockExchangeSnapshots } from "@/lib/turn/stockExchangeSnapshot";

interface RouteParams {
  params: Promise<{ code: string }>;
}

export async function POST(request: Request, { params }: RouteParams) {
  try {
    const auth = await requireHumanSession(request);
    if (!auth.ok) return auth.response;

    const rateLimit = checkRateLimit(auth.user.userId, 10, 60000);
    if (!rateLimit.ok) return rateLimitResponse(rateLimit.retryAfter);

    const { code } = await params;
    const countryId = code.toUpperCase() as CountryId;
    if (!COUNTRY_CONFIGS[countryId]) {
      return errorResponse(400, "Invalid country code");
    }

    const parsed = await parseJsonBody(request, executiveNationalizeSchema);
    if (!parsed.success) {
      return errorResponse(parsed.status, parsed.error);
    }
    const { corporationId, sectorId, tier } = parsed.data;

    const db = await getDb();

    // Authority: only the sitting head of government may order an executive taking.
    const character = await getCharacterByUserId(db, auth.user.userId);
    if (!character) {
      return errorResponse(404, "Character not found");
    }
    const isLeader = await isSittingLeader(db, countryId, character._id);
    if (!isLeader) {
      return errorResponse(
        403,
        "Only the head of government may order an executive nationalization."
      );
    }

    if (corporationId && !ObjectId.isValid(corporationId)) {
      return errorResponse(400, "Invalid corporation ID");
    }
    if (sectorId && !ObjectId.isValid(sectorId)) {
      return errorResponse(400, "Invalid sector ID");
    }

    const corps = db.collection<Corporation>("corporations");

    // Resolve the target corporation (whole-corp directly, or the sector's owner).
    let targetCorp: Corporation | null = null;
    let targetSector: CorporateSector | null = null;
    if (corporationId) {
      targetCorp = await corps.findOne({ _id: new ObjectId(corporationId) });
    } else if (sectorId) {
      targetSector = await db
        .collection<CorporateSector>("corporateSectors")
        .findOne({ _id: new ObjectId(sectorId) });
      if (targetSector) {
        targetCorp = await corps.findOne({ _id: targetSector.corporationId });
      }
    }
    if (!targetCorp) {
      return errorResponse(404, "Target not found");
    }

    // A national corporation cannot be a target (most fundamental rejection —
    // checked before jurisdiction so it always wins).
    if (isStateOwned(targetCorp)) {
      return errorResponse(400, "That corporation is already state-owned.");
    }

    const currentTurn = await getCurrentTurn(db);

    // An executive taking changes the listed set immediately (a seized corp is
    // absorbed/delisted; a sector taking shrinks the corp). Rebuild the
    // stock-exchange snapshot now so the Stock Market reflects it without waiting
    // for the 15-min cron — closing the window where only the actor knows. A
    // snapshot hiccup must not fail the taking.
    const refreshStockMarket = async () => {
      try {
        await generateStockExchangeSnapshots(currentTurn, db);
      } catch (snapErr) {
        console.error("[nationalize] stock-exchange snapshot refresh failed:", snapErr);
      }
    };

    // Re-nationalization cooldown (spec §13.4): a just-privatized corp cannot be
    // immediately re-seized.
    if (isWithinRenationalizeCooldown(targetCorp, currentTurn)) {
      return errorResponse(
        400,
        "This corporation was recently privatized and cannot be re-nationalized yet."
      );
    }

    // Jurisdiction: a government may only nationalize assets within its own
    // country. For a whole-corp taking the corp must be HQ'd here; for a single
    // sector the sector must operate here (a foreign-HQ corp's domestic sector
    // is reachable, its whole corp is not). Without this, the sitting leader of
    // one country could absorb another country's assets.
    if (sectorId && targetSector) {
      if (targetSector.countryId !== countryId) {
        return errorResponse(403, "That sector does not operate in your country.");
      }
    } else if (targetCorp.countryId !== countryId) {
      return errorResponse(403, "That corporation is not headquartered in your country.");
    }

    // Owner classification + eligibility (shared with the eligible-targets route
    // via resolveCorpEligibility so the two never drift). The executive-reach rule
    // below is unchanged; eligibility only makes `elig.triggers` accurate so the
    // consequence framing reflects WHY the corp is eligible.
    const { ownerKind, result: elig } = await resolveCorpEligibility(
      db,
      countryId,
      targetCorp,
      currentTurn
    );

    // Executive-reach rule: emergency power reaches NPC/unowned + distressed
    // player corps only. A solvent player corp needs legislative authorization.
    if (ownerKind === "player" && !elig.isDistressed) {
      return errorResponse(
        403,
        "Executive power can only nationalize failing firms. A solvent private corporation requires legislative authorization."
      );
    }

    if (!elig.eligible) {
      return errorResponse(400, "This asset is not currently eligible for nationalization.");
    }

    // Politics context for the consequences layer (spec §12). Executive method;
    // triggers come straight from the eligibility result (same union). Ideology
    // is neutral here (no governing-party resolution on the executive route yet);
    // the legislative path (P3b) supplies a party.
    const consequence = {
      method: "executive" as const,
      triggers: elig.triggers,
      turn: currentTurn,
      actorCharacterId: character._id,
      governingPartyId: null,
    };

    if (sectorId && targetSector) {
      const result = await nationalizeSector(db, {
        countryId,
        sectorId: targetSector._id,
        tier,
        consequence,
      });
      await refreshStockMarket();
      return NextResponse.json({ success: true, ...result });
    }

    const result = await nationalizeWholeCorp(db, {
      countryId,
      corporationId: targetCorp._id,
      tier,
      consequence,
    });
    await refreshStockMarket();
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    return handleRouteError(error);
  }
}
