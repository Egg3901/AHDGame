import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { requireCorporationActionsEnabled } from "@/lib/api/requireCorporationActions";
import { requireBasicAuth } from "@/lib/api/requireAuth";
import { parseJsonBody } from "@/lib/api/validate";
import { setGrowthRateSchema } from "@/lib/api/schemas/corporations";
import { handleRouteError } from "@/lib/api/errors";
import { resolveCorporation, requireCeo } from "@/lib/api/corporations/resolveQuery";
import type { Character, CorporateSector, State } from "@/lib/db/types";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
import { fetchSectorMarketSharePercent } from "@/lib/corporations/marketShare";
import { growthCostFor, resolveCountryPrimeRate } from "@/lib/corporations/sectorGrowthCost";
import { getCorpTechGrowthCostMultiplier } from "@/lib/corporations/techTree/corpEffects";
import { NEUTRAL_STAT } from "@/lib/stats/statsConstants";
import { logEconomicAction } from "@/lib/corporations/economicActionLog";
import { getCurrentTurn } from "@/lib/turn/currentTurn";

interface RouteParams {
  params: Promise<{ id: string; sectorId: string }>;
}

/**
 * POST /api/corporations/[id]/sectors/[sectorId]/growth
 * Set growth rate for a specific sector. CEO only.
 */
export async function setSectorGrowth(request: Request, { params }: RouteParams) {
  try {
    const auth = await requireBasicAuth();
    if (!auth.ok) return auth.response;

    const rateLimit = checkRateLimit(auth.user.userId, 20, 60000);
    if (!rateLimit.ok) return rateLimitResponse(rateLimit.retryAfter);

    const { id, sectorId } = await params;
    const parsed = await parseJsonBody(request, setGrowthRateSchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }

    const { targetGrowthRate: growthRate, preview } = parsed.data;
    const db = await getDb();
    const corpGuard = await requireCorporationActionsEnabled(db);
    if (corpGuard) return corpGuard;

    // PLANTS-GATED: growth targets do not drive anything under plants (capacity
    // is bought via buildCapacity); the UI hides this control, and the API must
    // refuse too or the slider becomes a silent no-op lever.
    {
      const { getMarketSystemModeForDb, isMarketSystemMode, marketAtLeast } =
        await import("@/lib/market/featureFlag");
      const mode = await getMarketSystemModeForDb(db);
      if (isMarketSystemMode(mode) && marketAtLeast(mode, "plants")) {
        return NextResponse.json(
          { error: "Growth targets are retired on this world. Use Build capacity instead." },
          { status: 400 }
        );
      }
    }

    // Find corporation
    const resolved = await resolveCorporation(db, id);
    if (!resolved.ok) return resolved.response;
    const { corporation } = resolved;

    const ceoCheck = requireCeo(corporation, auth.user.userId);
    if (ceoCheck) return ceoCheck;

    // Find sector
    if (!ObjectId.isValid(sectorId)) {
      return NextResponse.json({ error: "Invalid sector ID" }, { status: 400 });
    }

    const sector = await db.collection<CorporateSector>("corporateSectors").findOne({
      _id: new ObjectId(sectorId),
      corporationId: corporation._id,
    });
    if (!sector) {
      return NextResponse.json({ error: "Sector not found" }, { status: 404 });
    }

    // Recompute cost on the **active** growth rate, not the new target. The turn
    // processor trends currentGrowthRate toward target by GROWTH_TREND_STEP_PER_TURN
    // and recharges based on that trended rate — if we wrote target-based cost
    // here, the UI would jump on every slider tick and snap back next turn.
    const activeGrowthRate = sector.currentGrowthRate ?? sector.growthRate ?? 0;
    // Host country, not the corporation's domicile: this feeds the prime rate
    // the growth-cost quote is discounted at and the country stamped on the
    // action log. The old chain fell through to the corp and then to a literal
    // "US", which quoted a foreign operation at American rates (ticket #1271,
    // the same defect `buildCapacity` and `expandSector` carried). State first,
    // matching `getSectorOperatingCountryId`: a stored `countryId` left stale by
    // a region changing hands is the case that precedence exists for.
    const sectorState = await db
      .collection<State>("states")
      .findOne({ _id: sector.stateId }, { projection: { countryId: 1 } });
    const countryId = sectorState?.countryId ?? sector.countryId ?? corporation.countryId;
    const primeRate = await resolveCountryPrimeRate(db, countryId);
    // Dominance penalty: dominant sectors (>{@link DOMINANCE_MARKET_SHARE_THRESHOLD}%
    // of (state, sectorType) market share) pay a 1.75–3× growth-cost multiplier —
    // fetch share so the persisted currentGrowthCost matches what the turn
    // processor will charge next turn.
    const marketSharePct = await fetchSectorMarketSharePercent(db, sector, corporation);
    // CEO Business Acumen lowers growth cost (and softens high rates) — read it so
    // the persisted/previewed cost matches what the turn engine will charge.
    const ceoChar = corporation.ceoId
      ? await db
          .collection<Character>("characters")
          .findOne({ _id: corporation.ceoId }, { projection: { "stats.businessAcumen": 1 } })
      : null;
    const ceoAcumen = ceoChar?.stats?.businessAcumen ?? NEUTRAL_STAT;
    // Sector tech-tree growth-cost discount (scoped to this sector's type), so
    // preview/persisted cost matches the turn.
    const techGrowthMult = await getCorpTechGrowthCostMultiplier(corporation, sector.sectorType);
    const newGrowthCost = growthCostFor(
      sector.revenue,
      activeGrowthRate,
      primeRate,
      marketSharePct,
      ceoAcumen,
      techGrowthMult
    );

    if (preview) {
      // Projected steady-state cost at the *target* rate (vs the active-rate cost
      // persisted on apply) — mirrors the bulk endpoint's preview projection.
      const projected = growthCostFor(
        sector.revenue,
        growthRate,
        primeRate,
        marketSharePct,
        ceoAcumen,
        techGrowthMult
      );
      const current = sector.currentGrowthCost ?? newGrowthCost;
      return NextResponse.json({
        success: true,
        preview: true,
        targetGrowthRate: growthRate,
        projectedCostPerTurn: Math.round(projected),
        currentCostPerTurn: Math.round(current),
        costDeltaPerTurn: Math.round(projected - current),
      });
    }

    await db.collection<CorporateSector>("corporateSectors").updateOne(
      { _id: sector._id },
      {
        $set: {
          targetGrowthRate: growthRate,
          currentGrowthCost: newGrowthCost,
          updatedAt: new Date(),
        },
      }
    );

    void logEconomicAction(db, {
      characterId: corporation.ceoId,
      userId: auth.user.userId,
      actionType: "growSector",
      targetState: sector.stateId,
      turn: await getCurrentTurn(db).catch(() => 0),
      characterName: corporation.name,
      countryId,
      // No economic-cost fields: setting a growth target charges no immediate
      // cash or MS — `newGrowthCost` is an ongoing per-turn cost, not a lump
      // spend at this action, so there is nothing correct to log here.
      result: {
        success: true,
        message: `Set ${sector.sectorType} growth target to ${growthRate} in ${sector.stateId}`,
      },
    }).catch(() => {});

    return NextResponse.json({
      success: true,
      targetGrowthRate: growthRate,
      currentGrowthCost: Math.round(newGrowthCost),
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
