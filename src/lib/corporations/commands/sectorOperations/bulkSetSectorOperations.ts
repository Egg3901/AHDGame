import { NextResponse } from "next/server";
import type { AnyBulkWriteOperation } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { requireCorporationActionsEnabled } from "@/lib/api/requireCorporationActions";
import { requireBasicAuth } from "@/lib/api/requireAuth";
import { parseJsonBody } from "@/lib/api/validate";
import { bulkSectorOperationsSchema } from "@/lib/api/schemas/corporations";
import { handleRouteError } from "@/lib/api/errors";
import { resolveCorporation, requireCeo } from "@/lib/api/corporations/resolveQuery";
import type { Character, CorporateSector } from "@/lib/db/types";
import { CORPORATION_TYPE_LABELS, type CorporationType } from "@/lib/constants/corporations";
import { clampProductionPolicy } from "@/lib/utils/productionPolicy";
import { clampPricingPosture } from "@/lib/market/clearing";
import { getMarketSystemMode, isMarketSystemMode, marketAtLeast } from "@/lib/market/featureFlag";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
import { fetchSectorMarketSharePercent } from "@/lib/corporations/marketShare";
import { growthCostFor, resolveCountryPrimeRate } from "@/lib/corporations/sectorGrowthCost";
import { getSectorTechEffects } from "@/lib/constants/techTree";
import { isSectorTechTreesEnabled } from "@/lib/corporations/techTree/featureFlag";
import { NEUTRAL_STAT } from "@/lib/stats/statsConstants";
import { logEconomicAction } from "@/lib/corporations/economicActionLog";
import { getCurrentTurn } from "@/lib/turn/currentTurn";

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * POST /api/corporations/[id]/sectors/bulk
 * Set growth, production policy, and/or pricing posture across every // pragma: allowlist secret
 * holding of a sector type (or all types, Corporate-Wide) in one country,
 * atomically. CEO only. Pricing posture requires marketSystemMode >= "clearing".
 *
 * Growth cost mirrors the single-sector path: the persisted currentGrowthCost is
 * recomputed from each holding's *active* rate (so it doesn't jump and snap back
 * next turn), while the response's projected cost is the steady-state cost once
 * each holding ramps to the new target.
 */
export async function bulkSetSectorOperations(request: Request, { params }: RouteParams) {
  try {
    const auth = await requireBasicAuth();
    if (!auth.ok) return auth.response;

    const rateLimit = checkRateLimit(auth.user.userId, 20, 60000);
    if (!rateLimit.ok) return rateLimitResponse(rateLimit.retryAfter);

    const { id } = await params;
    const parsed = await parseJsonBody(request, bulkSectorOperationsSchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }
    const body = parsed.data;
    const { countryId, sectorType, targetGrowthRate, preview } = body;
    const productionPolicy = body.productionPolicy; // pragma: allowlist secret
    const { pricingPosture } = body;

    const db = await getDb();
    const corpGuard = await requireCorporationActionsEnabled(db);
    if (corpGuard) return corpGuard;

    const resolved = await resolveCorporation(db, id);
    if (!resolved.ok) return resolved.response;
    const { corporation } = resolved;

    const ceoCheck = requireCeo(corporation, auth.user.userId);
    if (ceoCheck) return ceoCheck;

    const bulkMode =
      pricingPosture !== undefined || targetGrowthRate !== undefined
        ? await getMarketSystemMode()
        : undefined;
    if (pricingPosture !== undefined) {
      if (!isMarketSystemMode(bulkMode) || !marketAtLeast(bulkMode, "clearing")) {
        return NextResponse.json(
          { error: "Market clearing is not enabled on this world" },
          { status: 400 }
        );
      }
    }

    // PLANTS-GATED: growth targets are retired under plants (capacity is bought
    // via buildCapacity); the UI hides these controls, and the API must refuse
    // too or bulk growth becomes a silent no-op lever.
    if (
      targetGrowthRate !== undefined &&
      isMarketSystemMode(bulkMode) &&
      marketAtLeast(bulkMode, "plants")
    ) {
      return NextResponse.json(
        { error: "Growth targets are retired on this world. Use Build capacity instead." },
        { status: 400 }
      );
    }

    const filter: Record<string, unknown> = { corporationId: corporation._id, countryId };
    if (sectorType) filter.sectorType = sectorType;

    const sectors = await db.collection<CorporateSector>("corporateSectors").find(filter).toArray();

    if (sectors.length === 0) {
      return NextResponse.json({ success: true, preview, matchedCount: 0, stateIds: [] });
    }

    const clampedPolicy =
      productionPolicy !== undefined ? clampProductionPolicy(productionPolicy) : undefined;
    const clampedPosture =
      pricingPosture === undefined
        ? undefined
        : pricingPosture == null
          ? null
          : clampPricingPosture(pricingPosture);

    // Growth: resolve prime rate once, then per-holding persisted + projected cost.
    let growthBlock:
      | {
          targetGrowthRate: number;
          projectedTotalCostPerTurn: number;
          currentTotalCostPerTurn: number;
          costDeltaPerTurn: number;
        }
      | undefined;
    const persistedCostBySector = new Map<string, number>();

    if (targetGrowthRate !== undefined) {
      const primeRate = await resolveCountryPrimeRate(db, countryId);
      // CEO Business Acumen lowers growth cost — read once so persisted/projected
      // costs match what the turn engine charges.
      const ceoChar = corporation.ceoId
        ? await db
            .collection<Character>("characters")
            .findOne({ _id: corporation.ceoId }, { projection: { "stats.businessAcumen": 1 } })
        : null;
      const ceoAcumen = ceoChar?.stats?.businessAcumen ?? NEUTRAL_STAT;
      // Sector tech-tree growth-cost discount — scoped per sector type. Read the
      // gate once; compute the multiplier per sector synchronously.
      const techEnabled = await isSectorTechTreesEnabled();
      const techCorpView = {
        type: corporation.type,
        unlockedTechNodeIds: corporation.unlockedTechNodeIds,
        techDecadeLane: corporation.techDecadeLane,
      };
      const techMultFor = (st: CorporationType) =>
        techEnabled ? getSectorTechEffects(techCorpView, st).growthCostMultiplier : 1;
      let projectedTotal = 0;
      let currentTotal = 0;
      for (const s of sectors) {
        const marketSharePct = await fetchSectorMarketSharePercent(db, s, corporation);
        const activeRate = s.currentGrowthRate ?? s.growthRate ?? 0;
        const techGrowthMult = techMultFor(s.sectorType);
        const persisted = growthCostFor(
          s.revenue,
          activeRate,
          primeRate,
          marketSharePct,
          ceoAcumen,
          techGrowthMult
        );
        const projected = growthCostFor(
          s.revenue,
          targetGrowthRate,
          primeRate,
          marketSharePct,
          ceoAcumen,
          techGrowthMult
        );
        persistedCostBySector.set(s._id.toString(), persisted);
        currentTotal += s.currentGrowthCost ?? persisted;
        projectedTotal += projected;
      }
      growthBlock = {
        targetGrowthRate,
        projectedTotalCostPerTurn: Math.round(projectedTotal),
        currentTotalCostPerTurn: Math.round(currentTotal),
        costDeltaPerTurn: Math.round(projectedTotal - currentTotal),
      };
    }

    const stateIds = sectors.map((s) => s.stateId);

    if (preview) {
      return NextResponse.json({
        success: true,
        preview: true,
        matchedCount: sectors.length,
        stateIds,
        ...(growthBlock ? { growth: growthBlock } : {}),
        ...(clampedPolicy !== undefined ? { production: { productionPolicy: clampedPolicy } } : {}),
        ...(clampedPosture !== undefined ? { pricing: { pricingPosture: clampedPosture } } : {}),
      });
    }

    const now = new Date();
    const ops: AnyBulkWriteOperation<CorporateSector>[] = sectors.map((s) => {
      const set: Record<string, unknown> = { updatedAt: now };
      if (targetGrowthRate !== undefined) {
        set.targetGrowthRate = targetGrowthRate;
        set.currentGrowthCost = persistedCostBySector.get(s._id.toString());
      }
      if (clampedPolicy !== undefined) set.productionPolicy = clampedPolicy;
      if (clampedPosture !== undefined) set.pricingPosture = clampedPosture;
      return { updateOne: { filter: { _id: s._id }, update: { $set: set } } };
    });
    await db.collection<CorporateSector>("corporateSectors").bulkWrite(ops);

    const typeLabel = sectorType ? CORPORATION_TYPE_LABELS[sectorType] : "all sectors";
    const parts: string[] = [];
    if (targetGrowthRate !== undefined) parts.push(`growth ${targetGrowthRate}%`);
    if (clampedPolicy !== undefined) parts.push(`production ${clampedPolicy}`);
    if (clampedPosture !== undefined) {
      parts.push(
        clampedPosture == null
          ? "pricing auto"
          : `pricing ${clampedPosture > 0 ? "+" : ""}${Math.round(clampedPosture * 100)}%`
      );
    }
    void logEconomicAction(db, {
      characterId: corporation.ceoId,
      userId: auth.user.userId,
      actionType: "growSector",
      turn: await getCurrentTurn(db).catch(() => 0),
      characterName: corporation.name,
      countryId,
      // Bulk growth / production / pricing: no immediate cash or MS. // pragma: allowlist secret
      result: {
        success: true,
        message: `Bulk set ${typeLabel} ${parts.join(" + ")} across ${sectors.length} holdings in ${countryId}`,
      },
    }).catch(() => {});

    return NextResponse.json({
      success: true,
      preview: false,
      matchedCount: sectors.length,
      stateIds,
      ...(growthBlock ? { growth: growthBlock } : {}),
      ...(clampedPolicy !== undefined ? { production: { productionPolicy: clampedPolicy } } : {}),
      ...(clampedPosture !== undefined ? { pricing: { pricingPosture: clampedPosture } } : {}),
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
