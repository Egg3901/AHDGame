/** Map a reconciled sector and explicit physical/cost facts into the one funded market. */
import type { CommodityType } from "@/lib/constants/commodities";
import type { CorporateSector } from "@/lib/db/types";
import { activeCapacityFraction } from "@/lib/corporations/investment/rules";
import { isStorable } from "@/lib/market/inventory";
import { advanceProducerCapacity } from "@/lib/market/producerMarket/capacityRules";
import { producerRecipe } from "@/lib/market/producerMarket/recipeRules";
import type { ProductionPlan } from "@/lib/market/producerMarket/production";
import type { ProducerSectorTarget } from "@/lib/market/producerMarket/settlement";

type SectorFacts = Pick<
  CorporateSector,
  | "_id"
  | "corporationId"
  | "sectorType"
  | "industryModel"
  | "mediaDiscriminator"
  | "capitalStock"
  | "capacityBookAnchor"
  | "buildQueue"
  | "mothballed"
  | "activeCapacityPercent"
  | "producerCapacity"
  | "producerInventory"
  | "producerQuotes"
>;

export function prepareProducerSector(input: {
  worldEpoch: string;
  turn: number;
  sector: SectorFacts;
  /** Resolved production method, including any product line or retool blend. */
  recipe: Parameters<typeof producerRecipe>[0];
  markets: ReadonlyMap<
    CommodityType,
    {
      book: string;
      referenceUnitPrice: number;
      maximumInputUnitPrice: number;
    }
  >;
  /** Physical effects only, including staffing, disasters and branch allocation. */
  outputMultiplier: number;
  operatingRecipeRatio: number;
  recessionCapacityFactor: number;
  labourCost: number;
  otherOperatingCost: number;
  labourRecipientAccountId: string;
  operatingRecipientAccountId: string;
}): { plan: ProductionPlan; target: ProducerSectorTarget } {
  const { sector } = input;
  const generation = sector.producerCapacity;
  const inventory = sector.producerInventory;
  if (
    !generation ||
    !inventory ||
    generation.worldEpoch !== input.worldEpoch ||
    inventory.worldEpoch !== input.worldEpoch ||
    generation.turn !== input.turn - 1 ||
    inventory.turn !== generation.turn
  )
    throw new Error("Producer sector requires a reconciled opening generation");
  if (
    sector.capitalStock == null ||
    sector.capacityBookAnchor == null ||
    !Array.isArray(sector.buildQueue)
  )
    throw new Error("Producer sector requires physical stock and paid basis");
  for (const amount of [input.outputMultiplier, input.labourCost, input.otherOperatingCost])
    if (!Number.isFinite(amount) || amount < 0) throw new Error("Invalid producer operating facts");
  const id = sector._id.toHexString();
  const target: ProducerSectorTarget = {
    producerId: id,
    sectorId: id,
    corporationId: sector.corporationId.toHexString(),
    capacity: {
      completedTurn: generation.turn,
      ownedDailyUnits: sector.capitalStock,
      paidBookAnchor: sector.capacityBookAnchor,
      buildQueue: sector.buildQueue,
    },
    operatingRecipeRatio: input.operatingRecipeRatio,
    recessionCapacityFactor: input.recessionCapacityFactor,
    plantType: {
      sectorType: sector.sectorType,
      industryModel: sector.industryModel,
      mediaDiscriminator: sector.mediaDiscriminator,
    },
  };
  const activeFraction = activeCapacityFraction(sector);
  const capacity = advanceProducerCapacity({
    state: target.capacity,
    turn: input.turn,
    activeFraction,
    operatingRecipeRatio: input.operatingRecipeRatio,
    recessionCapacityFactor: input.recessionCapacityFactor,
  });
  const recipe = producerRecipe(input.recipe);
  const marketFor = (commodity: CommodityType) => {
    const market = input.markets.get(commodity);
    if (
      !market ||
      !market.book ||
      !Number.isFinite(market.referenceUnitPrice) ||
      market.referenceUnitPrice < 0 ||
      !Number.isFinite(market.maximumInputUnitPrice) ||
      market.maximumInputUnitPrice < 0
    )
      throw new Error("Missing valued producer market");
    return market;
  };
  return {
    target,
    plan: {
      id,
      accountId: target.corporationId,
      capacityUnits: capacity.capacityUnits,
      activeFraction,
      outputMultiplier: input.outputMultiplier,
      inputs: recipe.inputs.map(({ commodity, unitsPerOutput }) => ({
        commodity,
        unitsPerOutput,
        book: marketFor(commodity).book,
        maximumUnitPrice: marketFor(commodity).maximumInputUnitPrice,
      })),
      outputs: recipe.outputs.map(({ commodity, unitsPerOutput }) => {
        const market = marketFor(commodity);
        return {
          commodity,
          unitsPerOutput,
          book: market.book,
          policy: sector.producerQuotes?.[commodity] ?? { kind: "automatic", targetMarkup: 0 },
          referenceUnitPrice: market.referenceUnitPrice,
          storable: isStorable(commodity),
        };
      }),
      labourCost: input.labourCost,
      otherOperatingCost: input.otherOperatingCost,
      labourRecipientAccountId: input.labourRecipientAccountId,
      operatingRecipientAccountId: input.operatingRecipientAccountId,
      inputStock: inventory.inputStock,
      outputStock: inventory.outputStock,
    },
  };
}
