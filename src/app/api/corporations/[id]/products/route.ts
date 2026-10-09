import { NextResponse } from "next/server";
import { type Db } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { getGameState } from "@/lib/gameState";
import { handleRouteError, errorResponse } from "@/lib/api/errors";
import { requireBasicAuth } from "@/lib/api/requireAuth";
import { resolveCorporation, requireCeo } from "@/lib/api/corporations/resolveQuery";
import { marketAtLeast, getMarketSystemMode } from "@/lib/market/featureFlag";
import type { GameConfig } from "@/lib/db/types/gameConfig";
import type { CorporateSector } from "@/lib/db/types/corporation";
import { sectorCapacityBookAnchor } from "@/lib/corporations/sectorProfitBasis";
import { getEraUnitScale } from "@/lib/constants/sectorSeedEra";
import { getCurrentTurn } from "@/lib/currentTurn";
import {
  allocationsForPlantCapacity,
  isLegalManufacturingProductForPlant,
  legalManufacturingProductKinds,
  type ManufacturingPlant,
} from "@/lib/products/rules/manufacturingEligibility";
import {
  MANUFACTURING_PRODUCT_KINDS,
  getManufacturingProductKind,
} from "@/lib/products/manufacturingCatalog";
import { SECTOR_STRATEGIES } from "@/lib/constants/sectorStrategies";
import {
  MANUFACTURING_PRODUCT_PROJECTS_V2,
  type ManufacturingProductProject,
} from "@/lib/products/manufacturingProject";

interface RouteParams {
  params: Promise<{ id: string }>;
}

type ManufacturingPlantSector = Pick<
  CorporateSector,
  | "_id"
  | "corporationId"
  | "sectorType"
  | "industryModel"
  | "strategyId"
  | "capacityBookAnchor"
  | "capitalStock"
  | "plantCount"
  | "mothballed"
  | "productLineProjectId"
  | "productLineOutputTurn"
  | "productLineOutputUnitsByCommodity"
  | "productLineSoldUnitsByCommodity"
  | "productLineQualityByCommodity"
>;

const noStore = { "Cache-Control": "private, no-store" };

async function productLinesAvailable(db: Db): Promise<boolean> {
  const config = await db
    .collection<GameConfig>("gameConfig")
    .findOne({ _id: "default" }, { projection: { marketSystemMode: 1, productLinesV2Enabled: 1 } });
  return (
    config?.productLinesV2Enabled === true &&
    marketAtLeast(await getMarketSystemMode(config), "plants")
  );
}

function manufacturingPlant(sector: ManufacturingPlantSector): ManufacturingPlant {
  return {
    sectorId: sector._id.toString(),
    corporationId: sector.corporationId.toString(),
    sectorType: sector.sectorType,
    industryModel: sector.industryModel,
    strategyId: sector.strategyId,
    capitalStock: sector.capitalStock ?? 0,
    plantCount: sector.plantCount ?? 0,
    mothballed: sector.mothballed,
  };
}

function projectView(project: ManufacturingProductProject | null) {
  if (!project) return null;
  const kind = getManufacturingProductKind(project.kindId);
  return {
    id: project._id,
    kindId: project.kindId,
    kindLabel: kind?.label ?? project.kindId,
    outputCommodity: kind?.outputCommodity,
    stage: project.stage,
    startedTurn: project.startedTurn,
    stageStartedTurn: project.stageStartedTurn,
    allocations: project.allocations,
    developmentPaidAnchor: project.developmentPaidAnchor,
    paidThresholdAnchor: project.paidThresholdAnchor,
    elapsedDevelopmentTurns: project.elapsedDevelopmentTurns,
    elapsedThresholdTurns: project.elapsedThresholdTurns,
    advertisingAllocationShare: project.advertisingAllocationShare ?? 0,
    developmentAdvertisingAnchor: project.developmentAdvertisingAnchor ?? 0,
    developmentAdvertisingTurns: project.developmentAdvertisingTurns ?? 0,
    productBrand: project.productBrand ?? 0,
  };
}

export async function GET(_request: Request, { params }: RouteParams) {
  try {
    const auth = await requireBasicAuth();
    if (!auth.ok) return auth.response;
    const { id } = await params;
    const db = await getDb();
    const resolved = await resolveCorporation(db, id);
    if (!resolved.ok) return resolved.response;
    const corporation = resolved.corporation;
    const enabled = await productLinesAvailable(db);
    if (!enabled) {
      return NextResponse.json(
        { enabled: false, isCeo: requireCeo(corporation, auth.user.userId) === null },
        { headers: noStore }
      );
    }

    const corporationId = corporation._id.toString();
    const sectors = await db
      .collection<CorporateSector>("corporateSectors")
      .find({ corporationId: corporation._id })
      .project<ManufacturingPlantSector>({
        _id: 1,
        corporationId: 1,
        sectorType: 1,
        industryModel: 1,
        strategyId: 1,
        capitalStock: 1,
        capacityBookAnchor: 1,
        plantCount: 1,
        mothballed: 1,
        productLineProjectId: 1,
        productLineOutputTurn: 1,
        productLineOutputUnitsByCommodity: 1,
        productLineSoldUnitsByCommodity: 1,
        productLineQualityByCommodity: 1,
      })
      .toArray();
    const [project] = await Promise.all([
      db.collection<ManufacturingProductProject>(MANUFACTURING_PRODUCT_PROJECTS_V2).findOne({
        activeCorporationId: corporationId,
      }),
    ]);
    const gameState = await getGameState(db);
    const plants = sectors.map((sector) => ({
      ...manufacturingPlant(sector),
      developmentCapitalAnchor: sectorCapacityBookAnchor(
        sector,
        gameState?.currentYear,
        getEraUnitScale(gameState?.preset)
      ),
    }));
    const techTreesEnabled = gameState?.sectorTechTreesEnabled === true;
    const eligibilityOptions = {
      currentYear: gameState?.currentYear,
      techTreesEnabled,
      unlockedTechNodeIds: corporation.unlockedTechNodeIds,
      techDecadeLane: corporation.techDecadeLane,
    };
    const legalKinds = legalManufacturingProductKinds(plants, {
      ...eligibilityOptions,
    });
    const allocations = project ? allocationsForPlantCapacity(plants, project.allocations) : [];
    const currentTurn = await getCurrentTurn(db);
    const projectKind = project ? getManufacturingProductKind(project.kindId) : undefined;
    const productResults =
      project && projectKind
        ? allocations.flatMap((allocation) => {
            const sector = sectors.find(
              (candidate) => candidate._id.toString() === allocation.sectorId
            );
            const turn = sector?.productLineOutputTurn;
            const producedUnits =
              sector?.productLineOutputUnitsByCommodity?.[projectKind.outputCommodity];
            const soldUnits =
              sector?.productLineSoldUnitsByCommodity?.[projectKind.outputCommodity];
            if (
              !sector ||
              sector.productLineProjectId !== project._id ||
              typeof turn !== "number" ||
              turn <= project.startedTurn ||
              typeof producedUnits !== "number" ||
              !Number.isFinite(producedUnits) ||
              producedUnits < 0 ||
              typeof soldUnits !== "number" ||
              !Number.isFinite(soldUnits) ||
              soldUnits < 0
            ) {
              return [];
            }
            const quality = sector.productLineQualityByCommodity?.[projectKind.outputCommodity];
            return [
              {
                sectorId: allocation.sectorId,
                turn,
                producedUnits,
                soldUnits: Math.min(producedUnits, soldUnits),
                quality: typeof quality === "number" && Number.isFinite(quality) ? quality : null,
              },
            ];
          })
        : [];

    return NextResponse.json(
      {
        enabled: true,
        isCeo: requireCeo(corporation, auth.user.userId) === null,
        currentTurn,
        activeProject: projectView(project),
        productResults,
        catalog: legalKinds.map((kind) => ({
          id: kind.id,
          label: kind.label,
          outputCommodity: kind.outputCommodity,
          sectorTypes: kind.sectorTypes,
          strategyIds: kind.strategyIds,
          technologyRequirements: kind.sectorTypes.flatMap((sectorType) =>
            SECTOR_STRATEGIES[sectorType].flatMap((strategy) =>
              kind.strategyIds.includes(strategy.id) &&
              (strategy.supply[kind.outputCommodity] ?? 0) > 0
                ? [
                    {
                      strategyId: strategy.id,
                      strategyName: strategy.name,
                      minDecade: strategy.minDecade ?? null,
                      requiresTechUnlock: strategy.requiresTechUnlock === true,
                    },
                  ]
                : []
            )
          ),
        })),
        plants: plants.map((plant) => ({
          ...plant,
          eligibleKindIds: MANUFACTURING_PRODUCT_KINDS.filter((kind) =>
            isLegalManufacturingProductForPlant(kind.id, plant, eligibilityOptions)
          ).map((kind) => kind.id),
        })),
        allocatedCapacityStock: allocations.reduce((sum, item) => sum + item.capacityStock, 0),
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
