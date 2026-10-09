import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { getGameState } from "@/lib/gameState";
import { getCurrentTurn } from "@/lib/currentTurn";
import { handleRouteError, errorResponse } from "@/lib/api/errors";
import { requireBasicAuth } from "@/lib/api/requireAuth";
import { resolveCorporation, requireCeo } from "@/lib/api/corporations/resolveQuery";
import { marketAtLeast, getMarketSystemMode } from "@/lib/market/featureFlag";
import type { GameConfig, CorporateSector } from "@/lib/db/types";
import { getMediaProductKind, MEDIA_PRODUCT_KINDS } from "@/lib/products/mediaProductCatalog";
import { getMediaOperatingModel } from "@/lib/mediaOperatingModels/catalog";
import { MEDIA_PRODUCT_PROJECTS, type MediaProductProject } from "@/lib/products/mediaProduct";

interface RouteParams {
  params: Promise<{ id: string }>;
}

const noStore = { "Cache-Control": "private, no-store" };

async function slatesAvailable(db: Awaited<ReturnType<typeof getDb>>) {
  const config = await db.collection<GameConfig>("gameConfig").findOne(
    { _id: "default" },
    {
      projection: {
        marketSystemMode: 1,
        mediaOperatingModelsEnabled: 1,
        mediaProductSlatesEnabled: 1,
        brandLoyaltyEnabled: 1,
        brandLoyaltySliceEnabled: 1,
        qualityPremiumPricingEnabled: 1,
      },
    }
  );
  return (
    config?.mediaProductSlatesEnabled === true &&
    config.mediaOperatingModelsEnabled === true &&
    config.brandLoyaltyEnabled === true &&
    config.brandLoyaltySliceEnabled === true &&
    config.qualityPremiumPricingEnabled === true &&
    marketAtLeast(await getMarketSystemMode(config), "clearing")
  );
}

export async function GET(_request: Request, { params }: RouteParams) {
  try {
    const auth = await requireBasicAuth();
    if (!auth.ok) return auth.response;
    const { id } = await params;
    const db = await getDb();
    const resolved = await resolveCorporation(db, id);
    if (!resolved.ok) return resolved.response;
    const enabled = await slatesAvailable(db);
    if (!enabled) {
      return NextResponse.json(
        { enabled: false, isCeo: requireCeo(resolved.corporation, auth.user.userId) === null },
        { headers: noStore }
      );
    }
    const corporationId = resolved.corporation._id.toString();
    const [projects, sectors, gameState, currentTurn] = await Promise.all([
      db
        .collection<MediaProductProject>(MEDIA_PRODUCT_PROJECTS)
        .find({ corporationId })
        .project<MediaProductProject>({
          _id: 1,
          corporationId: 1,
          activeDevelopmentCorporationId: 1,
          sectorId: 1,
          operatingSectorType: 1,
          kindId: 1,
          title: 1,
          allocationShare: 1,
          stage: 1,
          startedTurn: 1,
          stageStartedTurn: 1,
          lastProcessedTurn: 1,
          developmentPaidAnchor: 1,
          paidThresholdAnchor: 1,
          elapsedDevelopmentTurns: 1,
          elapsedThresholdTurns: 1,
          developmentAdvertisingAnchor: 1,
          developmentAdvertisingTurns: 1,
          launchQuality: 1,
          qualityBonus: 1,
          productBrand: 1,
        })
        .toArray(),
      db
        .collection<CorporateSector>("corporateSectors")
        .find({ corporationId: resolved.corporation._id })
        .project({
          _id: 1,
          sectorType: 1,
          mediaDiscriminator: 1,
          strategyId: 1,
          capitalStock: 1,
          capacityBookAnchor: 1,
        })
        .toArray(),
      getGameState(),
      getCurrentTurn(db),
    ]);
    const eligibleSectors = sectors.filter((sector) => {
      if (sector.sectorType !== "media") return false;
      return MEDIA_PRODUCT_KINDS.some(
        (kind) =>
          kind.modelId === sector.strategyId &&
          (gameState?.currentYear ?? 0) >=
            (getMediaOperatingModel(kind.modelId)?.availableFromYear ?? Number.MAX_SAFE_INTEGER)
      );
    });
    return NextResponse.json(
      {
        enabled: true,
        isCeo: requireCeo(resolved.corporation, auth.user.userId) === null,
        currentTurn,
        currentYear: gameState?.currentYear ?? null,
        projects: projects.map((project) => ({
          ...project,
          kindLabel: getMediaProductKind(project.kindId)?.label ?? project.kindId,
        })),
        catalog: MEDIA_PRODUCT_KINDS.map(
          ({ id: kindId, modelId, label, coverage, durations, tail }) => ({
            id: kindId,
            modelId,
            label,
            coverage,
            durations,
            tail,
            eligibleSectorIds: eligibleSectors
              .filter((sector) => sector.strategyId === modelId)
              .map((sector) => sector._id.toString()),
          })
        ),
        sectors: eligibleSectors.map((sector) => ({
          id: sector._id.toString(),
          strategyId: sector.strategyId,
          operatingSectorType:
            sector.mediaDiscriminator === "entertainment" ? "media_entertainment" : "media",
          capitalStock: sector.capitalStock ?? 0,
        })),
      },
      { headers: noStore }
    );
  } catch (error) {
    return handleRouteError(error);
  }
}

/**
 * New product projects are started in the product studio (`/ventures`).
 * Projects already in flight keep running and can still be read and retired.
 */
export async function POST() {
  return errorResponse(
    410,
    "Starting products here has moved to the product studio. Use the ventures endpoint."
  );
}
