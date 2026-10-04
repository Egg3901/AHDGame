import { ObjectId, type Db } from "mongodb";
import { marketAtLeast, getMarketSystemMode } from "@/lib/market/featureFlag";
import type { GameConfig } from "@/lib/db/types/gameConfig";
import type { Corporation, CorporateSector, StateMetrics } from "@/lib/db/types";
import {
  MANUFACTURING_PRODUCT_PROJECTS_V2,
  type ManufacturingProductProject,
} from "@/lib/products/manufacturingProject";
import { selectNppManufacturingProduct } from "@/lib/products/rules/selectNppManufacturingProduct";
import type { CommodityPriceRatioFn } from "@/lib/turn/npp/marketSignals";
import { sectorCapacityBookAnchor } from "@/lib/corporations/sectorProfitBasis";
import type { TechLane } from "@/lib/constants/techTree/nodes";
import {
  MANUFACTURING_DEVELOPMENT_ELAPSED_TURNS,
  manufacturingDevelopmentThresholdAnchor,
  allocatedManufacturingCapitalAnchor,
} from "@/lib/products/rules/manufacturingRules";

export async function loadNppProductProjectsV2(
  db: Db,
  nppCorporations: readonly Pick<Corporation, "_id">[]
): Promise<{
  plantsEnabled: boolean;
  productLinesEnabled: boolean;
  activeProjectByCorporationId: Map<string, ManufacturingProductProject>;
}> {
  const config = await db
    .collection<GameConfig>("gameConfig")
    .findOne({ _id: "default" }, { projection: { marketSystemMode: 1, productLinesV2Enabled: 1 } });
  const plantsEnabled = marketAtLeast(await getMarketSystemMode(config), "plants");
  const productLinesEnabled = plantsEnabled && config?.productLinesV2Enabled === true;
  const activeProjectByCorporationId = new Map<string, ManufacturingProductProject>();
  if (productLinesEnabled) {
    const activeProjects = await db
      .collection<ManufacturingProductProject>(MANUFACTURING_PRODUCT_PROJECTS_V2)
      .find<ManufacturingProductProject>({
        activeCorporationId: { $in: nppCorporations.map((corp) => corp._id.toString()) },
      })
      .project<ManufacturingProductProject>({
        _id: 1,
        corporationId: 1,
        activeCorporationId: 1,
        kindId: 1,
        stage: 1,
        stageStartedTurn: 1,
        allocations: 1,
        startedTurn: 1,
        lastProcessedTurn: 1,
        lastDevelopmentReceiptTurn: 1,
        developmentPaidAnchor: 1,
        paidThresholdAnchor: 1,
        elapsedDevelopmentTurns: 1,
        elapsedThresholdTurns: 1,
      })
      .toArray();
    for (const project of activeProjects) {
      activeProjectByCorporationId.set(project.corporationId, project);
    }
  }
  return { plantsEnabled, productLinesEnabled, activeProjectByCorporationId };
}

export async function loadNppCostOfLivingByState(db: Db): Promise<Map<string, number>> {
  const documents = await db
    .collection<StateMetrics>("macroMetrics")
    .find({}, { projection: { "economic.costOfLiving": 1 } })
    .toArray();
  return new Map(
    documents.flatMap((document) => {
      const value = document.economic?.costOfLiving?.value;
      return typeof value === "number" && Number.isFinite(value)
        ? [[String(document._id), value] as const]
        : [];
    })
  );
}

export function createNppManufacturingProductProjectV2(input: {
  corporationId: string;
  sectors: readonly CorporateSector[];
  turn: number;
  currentYear?: number;
  techTreesEnabled: boolean;
  unlockedTechNodeIds?: readonly string[];
  techDecadeLane?: Record<string, TechLane>;
  eraUnitScale: number;
  priceRatioOf: CommodityPriceRatioFn;
}): ManufacturingProductProject | undefined {
  const selectedProduct = selectNppManufacturingProduct(input);
  if (!selectedProduct) return undefined;
  return {
    _id: new ObjectId().toString(),
    corporationId: input.corporationId,
    activeCorporationId: input.corporationId,
    kindId: selectedProduct.kindId,
    stage: "development",
    stageStartedTurn: input.turn,
    allocations: selectedProduct.allocations,
    startedTurn: input.turn,
    developmentPaidAnchor: 0,
    paidThresholdAnchor: manufacturingDevelopmentThresholdAnchor(
      allocatedManufacturingCapitalAnchor(
        input.sectors.map((sector) => ({
          sectorId: sector._id.toString(),
          developmentCapitalAnchor: sectorCapacityBookAnchor(
            sector,
            input.currentYear,
            input.eraUnitScale
          ),
        })),
        selectedProduct.allocations
      )
    ),
    elapsedDevelopmentTurns: 0,
    elapsedThresholdTurns: MANUFACTURING_DEVELOPMENT_ELAPSED_TURNS,
  };
}

export function buildNppProductProjectsV2(input: {
  state: Awaited<ReturnType<typeof loadNppProductProjectsV2>>;
  nppCorporations: readonly Pick<Corporation, "_id" | "unlockedTechNodeIds" | "techDecadeLane">[];
  sectorsByCorp: ReadonlyMap<string, readonly CorporateSector[]>;
  turn: number;
  techCurrentYear: number;
  techTreesEnabled: boolean;
  plants?: { enabled: boolean; eraUnitScale: number };
  priceRatioOf: CommodityPriceRatioFn;
}): ManufacturingProductProject[] {
  const plants = input.plants;
  if (!input.state.productLinesEnabled || !plants?.enabled) return [];
  return input.nppCorporations.flatMap((corporation) => {
    const corporationId = corporation._id.toString();
    if (input.state.activeProjectByCorporationId.has(corporationId)) return [];
    const project = createNppManufacturingProductProjectV2({
      corporationId,
      sectors: input.sectorsByCorp.get(corporationId) ?? [],
      turn: input.turn,
      currentYear: input.techCurrentYear > 0 ? input.techCurrentYear : undefined,
      techTreesEnabled: input.techTreesEnabled,
      unlockedTechNodeIds: corporation.unlockedTechNodeIds,
      techDecadeLane: corporation.techDecadeLane,
      eraUnitScale: plants.eraUnitScale,
      priceRatioOf: input.priceRatioOf,
    });
    return project ? [project] : [];
  });
}
