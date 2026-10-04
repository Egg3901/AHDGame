import { ObjectId, type Db } from "mongodb";
import type { CommodityType } from "@/lib/constants/commodities";
import { marketAtLeast, getMarketSystemMode } from "@/lib/market/featureFlag";
import type { GameConfig } from "@/lib/db/types/gameConfig";
import type { Corporation, CorporateSector, StateMetrics } from "@/lib/db/types";
import {
  MANUFACTURING_PRODUCT_PROJECTS_V2,
  type ManufacturingProductProject,
} from "@/lib/products/manufacturingProject";
import { selectNppManufacturingProduct } from "@/lib/products/rules/selectNppManufacturingProduct";
import {
  MANUFACTURING_DEVELOPMENT_ELAPSED_TURNS,
  manufacturingDevelopmentThresholdAnchor,
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
      .find({ activeCorporationId: { $in: nppCorporations.map((corp) => corp._id.toString()) } })
      .project({
        _id: 1,
        corporationId: 1,
        activeCorporationId: 1,
        kindId: 1,
        stage: 1,
        stageStartedTurn: 1,
        allocations: 1,
        startedTurn: 1,
        lastProcessedTurn: 1,
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
  eraUnitScale: number;
  priceRatioOf: (commodity: CommodityType) => number;
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
    paidThresholdAnchor: manufacturingDevelopmentThresholdAnchor(selectedProduct.capacityStock),
    elapsedDevelopmentTurns: 0,
    elapsedThresholdTurns: MANUFACTURING_DEVELOPMENT_ELAPSED_TURNS,
  };
}

export function buildNppProductProjectsV2(input: {
  state: Awaited<ReturnType<typeof loadNppProductProjectsV2>>;
  nppCorporations: readonly Pick<Corporation, "_id" | "unlockedTechNodeIds">[];
  sectorsByCorp: ReadonlyMap<string, readonly CorporateSector[]>;
  turn: number;
  techCurrentYear: number;
  techTreesEnabled: boolean;
  plants?: { enabled: boolean; eraUnitScale: number };
  priceRatioOf: (commodity: CommodityType) => number;
}): ManufacturingProductProject[] {
  if (!input.state.productLinesEnabled || !input.plants?.enabled) return [];
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
      eraUnitScale: input.plants.eraUnitScale,
      priceRatioOf: input.priceRatioOf,
    });
    return project ? [project] : [];
  });
}
