import { DEFAULT_SEED_PRESET } from "@/lib/constants/seedPreset";
/**
 * Sector strategies a corporation can pick, and what switching costs. Each sector
 * type has 4 to 8 strategies in SECTOR_STRATEGIES that change which commodities it
 * consumes and produces; margin follows the commodity market, not the strategy.
 * Switching charges 25% of daily revenue, phases in over 12 turns with a -5 point
 * margin penalty, and locks further changes for 24 turns (getEffectiveStrategyRates).
 */
/**
 * Sector Operating Strategies.
 *
 * Each sector type has 4-8 strategies that change its commodity input/output
 * rates. Margin impacts come naturally from commodity market dynamics — there
 * is NO direct margin modifier per strategy. During a transition, a flat −5%
 * margin penalty applies to represent retooling disruption.
 *
 * Switching strategy costs 25% of daily revenue, transitions linearly over
 * 12 turns, and has a 24-turn cooldown from initiation (runs concurrently
 * with the transition).
 */

import * as Sentry from "@sentry/nextjs";
import type { CorporationType, ManufacturingIndustryModel } from "./corporations";
import type { CommodityType } from "./commodities";
import { COMMODITY_BASE_PRICES } from "./commodities";
import {
  MEDIA_OPERATING_MODELS,
  mediaOperatingModelOutputRates,
  type MediaOperatingModelSector,
} from "@/lib/mediaOperatingModels/catalog";

import { eraForPreset } from "@/lib/seeds/presetSelector";
import { DEFAULT_DEMAND_1991 } from "./sectorStrategyDefinitions1991";
import { SECTOR_STRATEGIES } from "./sectorStrategyDefinitions";
import {
  CANCEL_COST_FRACTION,
  STRATEGY_COOLDOWN_TURNS,
  STRATEGY_RETOOL_COST_FRACTION,
  STRATEGY_TRANSITION_MARGIN_PENALTY,
  STRATEGY_TRANSITION_TURNS,
  type EffectiveStrategyRates,
  type SectorStrategy,
} from "./sectorStrategyTypes";

export {
  CANCEL_COST_FRACTION,
  SECTOR_STRATEGIES,
  STRATEGY_COOLDOWN_TURNS,
  STRATEGY_RETOOL_COST_FRACTION,
  STRATEGY_TRANSITION_MARGIN_PENALTY,
  STRATEGY_TRANSITION_TURNS,
};
export type { EffectiveStrategyRates, SectorStrategy };

// ─── Helpers ────────────────────────────────────────────────────────────────

const reportedUnknownSectorTypes = new Set<string>();
const UNKNOWN_SECTOR_STRATEGY: SectorStrategy = {
  id: "standard",
  name: "Unknown sector",
  description: "Production is unavailable until this sector type is recognized.",
  supply: {},
  demand: {},
};

/**
 * Build the model recipes from existing physical input baskets and output
 * patterns. Output rates retain the default sector's base-value budget; input
 * costs remain on the ordinary strategy demand and physical-cost rails.
 */
export function getMediaOperatingModelStrategies(sectorType: string): SectorStrategy[] {
  if (sectorType !== "media" && sectorType !== "entertainment") return [];
  const lane = sectorType as MediaOperatingModelSector;
  const strategies = SECTOR_STRATEGIES[sectorType as CorporationType];
  const baseline = strategies.find((strategy) => strategy.id === "standard");
  if (!baseline) return [];

  return MEDIA_OPERATING_MODELS.flatMap((model) => {
    const recipe = model.recipes[lane];
    if (!recipe) return [];
    const input = strategies.find((strategy) => strategy.id === recipe.inputStrategyId);
    const output = SECTOR_STRATEGIES[lane].find(
      (strategy) => strategy.id === recipe.outputStrategyId
    );
    if (!input || !output) return [];

    const outputSourceRates = Object.fromEntries(
      model.outputProducts.flatMap((commodity) => {
        const rate = output.supply[commodity];
        return typeof rate === "number" && Number.isFinite(rate) && rate > 0
          ? [[commodity, rate]]
          : [];
      })
    ) as Partial<Record<"advertising" | "entertainment_services", number>>;
    const sourceBudget = Object.values(outputSourceRates).reduce(
      (total, rate) => total + (rate ?? 0),
      0
    );
    if (sourceBudget <= 0) return [];
    const outputValueShares = Object.fromEntries(
      Object.entries(outputSourceRates).map(([commodity, rate]) => [
        commodity,
        (rate ?? 0) / sourceBudget,
      ])
    ) as Partial<Record<"advertising" | "entertainment_services", number>>;

    return [
      {
        id: model.id,
        name: model.name,
        description: `${model.name} operating model using established ${recipe.inputStrategyId.replaceAll("_", " ")} inputs.`,
        supply: mediaOperatingModelOutputRates(baseline.supply, outputValueShares),
        demand: { ...input.demand },
        ...(model.technologies[lane] ? { minDecade: model.technologies[lane]?.decade } : {}),
        requiresTechUnlock: Boolean(model.technologies[lane]),
        mediaOperatingModelId: model.id,
      },
    ];
  });
}

/**
 * Look up a strategy by sector type and strategy ID.
 * Falls back to the sector's first strategy if the strategy ID is unknown.
 * Unknown persisted sector types use an inert strategy until repaired.
 */
function strategyForPreset(
  sectorType: string,
  strategy: SectorStrategy,
  preset?: string
): SectorStrategy {
  const demand =
    strategy.id === "standard" && eraForPreset(preset ?? DEFAULT_SEED_PRESET) === "1991"
      ? DEFAULT_DEMAND_1991[sectorType as CorporationType]
      : undefined;
  return demand ? { ...strategy, demand: { ...demand } } : strategy;
}

export function getStrategy(
  sectorType: string,
  strategyId: string,
  preset?: string
): SectorStrategy {
  if (!Object.hasOwn(SECTOR_STRATEGIES, sectorType)) {
    if (!reportedUnknownSectorTypes.has(sectorType)) {
      reportedUnknownSectorTypes.add(sectorType);
      Sentry.captureMessage("Unknown persisted sector type: using inert strategy", {
        level: "error",
        extra: { sectorType },
      });
    }
    return UNKNOWN_SECTOR_STRATEGY;
  }
  const strategies = SECTOR_STRATEGIES[sectorType as CorporationType];
  const strategy =
    strategies.find((s) => s.id === strategyId) ??
    getMediaOperatingModelStrategies(sectorType).find((s) => s.id === strategyId) ??
    strategies[0];
  return strategyForPreset(sectorType, strategy, preset);
}

/** Strategy options for queries and menus. Model options are omitted unless enabled. */
export function getSectorStrategies(
  sectorType: string,
  mediaOperatingModelsEnabled = false,
  mediaDiscriminator?: string | null,
  preset?: string
): SectorStrategy[] {
  const operatingType = getOperatingSectorType(sectorType, undefined, mediaDiscriminator);
  if (!Object.hasOwn(SECTOR_STRATEGIES, operatingType)) return [];
  const strategies = SECTOR_STRATEGIES[operatingType as CorporationType].map((strategy) =>
    strategyForPreset(operatingType, strategy, preset)
  );
  return mediaOperatingModelsEnabled
    ? [...strategies, ...getMediaOperatingModelStrategies(operatingType)]
    : strategies;
}

/** Resolve the legacy economic profile represented by a persisted sector. */
export function getOperatingSectorType(
  sectorType: string,
  industryModel?: ManufacturingIndustryModel | string | null,
  mediaDiscriminator?: string | null
): string {
  if (sectorType === "manufacturing" && industryModel === "vehicles") return "automobiles";
  if (sectorType === "media" && mediaDiscriminator === "entertainment") return "entertainment";
  return sectorType;
}

/**
 * Resolve a strategy for a persisted sector and its optional manufacturing
 * production model. Vehicle models reuse the unchanged automobile recipes.
 */
export function getStrategyForOperatingModel(
  sectorType: string,
  strategyId: string,
  industryModel?: string | null,
  mediaDiscriminator?: string | null,
  preset?: string
): SectorStrategy {
  return getStrategy(
    getOperatingSectorType(sectorType, industryModel, mediaDiscriminator),
    strategyId,
    preset
  );
}

/**
 * Compute effective supply/demand rates for a sector, handling transitions.
 *
 * During a transition the rates are linearly interpolated between the old
 * and new strategy over STRATEGY_TRANSITION_TURNS turns.
 */
export function getEffectiveStrategyRates(
  sectorType: string,
  strategyId: string,
  transitionFromStrategyId: string | undefined | null,
  transitionStartTurn: number | undefined | null,
  currentTurn: number,
  mediaDiscriminator?: string | null,
  preset?: string
): EffectiveStrategyRates {
  const operatingType = getOperatingSectorType(sectorType, undefined, mediaDiscriminator);
  const target = getStrategy(operatingType, strategyId, preset);

  // No transition in progress → return target directly
  if (!transitionFromStrategyId || transitionStartTurn == null) {
    return {
      supply: { ...target.supply },
      demand: { ...target.demand },
      isTransitioning: false,
    };
  }

  const elapsed = currentTurn - transitionStartTurn;
  const progress = Math.min(1, Math.max(0, elapsed / STRATEGY_TRANSITION_TURNS));

  // Transition complete → return target directly
  if (progress >= 1) {
    return {
      supply: { ...target.supply },
      demand: { ...target.demand },
      isTransitioning: false,
    };
  }

  const source = getStrategy(operatingType, transitionFromStrategyId, preset);

  // Interpolate each commodity rate
  const supply = blendRates(source.supply, target.supply, progress);
  const demand = blendRates(source.demand, target.demand, progress);

  return { supply, demand, isTransitioning: true };
}

/** Resolve a strategy transition through the sector's optional production model. */
export function getEffectiveStrategyRatesForOperatingModel(
  sectorType: string,
  strategyId: string,
  transitionFromStrategyId: string | undefined | null,
  transitionStartTurn: number | undefined | null,
  currentTurn: number,
  industryModel?: string | null,
  mediaDiscriminator?: string | null,
  preset?: string
): EffectiveStrategyRates {
  return getEffectiveStrategyRates(
    getOperatingSectorType(sectorType, industryModel, mediaDiscriminator),
    strategyId,
    transitionFromStrategyId,
    transitionStartTurn,
    currentTurn,
    mediaDiscriminator,
    preset
  );
}

/** Linearly blend two rate maps. Commodities in either map are included. */
function blendRates(
  from: Partial<Record<CommodityType, number>>,
  to: Partial<Record<CommodityType, number>>,
  progress: number
): Partial<Record<CommodityType, number>> {
  const allKeys = new Set([
    ...(Object.keys(from) as CommodityType[]),
    ...(Object.keys(to) as CommodityType[]),
  ]);
  const result: Partial<Record<CommodityType, number>> = {};
  for (const key of allKeys) {
    const fromVal = from[key] ?? 0;
    const toVal = to[key] ?? 0;
    const blended = fromVal * (1 - progress) + toVal * progress;
    if (blended > 0) {
      result[key] = Math.round(blended * 10000) / 10000;
    }
  }
  return result;
}

// ─── Planned-economy output remap ───────────────────────────────────────────

/**
 * What media produces in a command economy instead of `advertising`.
 *
 * Advertising is a market institution: it exists because rival brands bid for
 * custom. A planned economy has no such contest, so its broadcasters, presses
 * and cinemas are producing state information and culture, which households
 * consume — not airtime sold to advertisers.
 *
 * The 1953 seed nonetheless gave every Warsaw Pact state a full commercial
 * media sector on the standard strategy, so the bloc was pushing 3,343,618
 * units/day of advertising — 54% of world supply — into economies whose
 * combined advertising demand was 4,736 units/day. Measured on prod at turn
 * 114: Hungary ran 1,181x oversupplied, Czechoslovakia and Bulgaria 786x,
 * Poland 779x. That glut set the world price and pinned it to the deflation
 * clamp at 0.32x base, so every media owner on Earth was selling ~2% of output
 * at a 68% discount.
 */
export const PLANNED_ECONOMY_MEDIA_OUTPUT: CommodityType = "entertainment_services";

/**
 * Re-denominate a sector's OUTPUT mix for a planned economy.
 *
 * Pure and total: returns the input untouched for market economies, for
 * non-media sectors, and for a mix that produces no advertising, so every
 * existing call site is byte-identical unless the sector is bloc media.
 *
 * MUST be applied at every site that resolves output rates — the world supply
 * ledger AND the clearing offer both — or the offered book and the ledger drift
 * apart and clearing's lagged-supply reconciliation misfires. That is why this
 * lives here rather than being inlined at either call site.
 */
export function applyPlannedEconomyOutputMix(
  sectorType: CorporationType,
  supply: Partial<Record<CommodityType, number>>,
  plannedEconomy: boolean,
  mediaDiscriminator: string | null | undefined
): Partial<Record<CommodityType, number>> {
  if (!plannedEconomy || !isNewsMediaLane(sectorType, mediaDiscriminator)) return supply;
  const advertising = supply.advertising ?? 0;
  if (!(advertising > 0)) return supply;
  const remapped: Partial<Record<CommodityType, number>> = { ...supply };
  delete remapped.advertising;
  // Preserve the CAPACITY UNIT YIELD k = Σ(rate / basePrice) — the quantity the
  // engine actually uses (`capacityUnitYield` → `revenuePerCapacityUnit` → build
  // cost and facility sizing). Holding k means the rate scales by
  // base_new / base_old, so 0.5 advertising becomes 2.0 state broadcasting.
  //
  // The obvious-looking alternative, conserving Σ(rate × basePrice), is not an
  // invariant of anything the engine computes: it moves k by the price ratio and
  // `facilityQuantum.test.ts` fails on the resulting RPU shift.
  //
  // This does NOT hold output VALUE constant. Under plants a single-commodity
  // mix has `commodityMixWeight` 1 whatever the rate, so the sector still makes
  // the same `producedUnits`, now priced at 600 rather than 150. Capacity is the
  // only lever for that, which is why the bloc media seed is right-sized in the
  // same pass. See ops-knowledge `plants-output-mix-invariants`.
  const rateScale =
    COMMODITY_BASE_PRICES[PLANNED_ECONOMY_MEDIA_OUTPUT] / COMMODITY_BASE_PRICES.advertising;
  remapped[PLANNED_ECONOMY_MEDIA_OUTPUT] =
    (remapped[PLANNED_ECONOMY_MEDIA_OUTPUT] ?? 0) + advertising * rateScale;
  return remapped;
}

/**
 * Share of a planned economy's media output that reaches the market.
 *
 * The 1953 seed sized every bloc state's media sector like a Western commercial
 * broadcaster — 82,000 to 806,000 capitalStock each, one per state — so the bloc
 * physically produces about 4x what a state media budget plausibly funds. Under
 * plants the output mix cannot express that: `commodityMixWeight` is 1 for a
 * single-commodity mix whatever the rate, so a re-pointed sector still makes the
 * same `producedUnits`. Capacity is the only real lever, and derating the market
 * contribution is the reversible, code-side form of it — no mutation of live
 * state-owned sectors.
 *
 * 0.25 is chosen to be REVENUE-NEUTRAL: state broadcasting prices at 4x
 * advertising, so a quarter of the units at four times the price is the same
 * ₳/day the sector would earn selling its whole advertising output. Bloc media
 * therefore neither gains free money from the re-pointing nor is broken by the
 * derate — and in practice it is a large gain, because today those sectors clear
 * 0.14% of output at a third of base price.
 *
 * Proper fix is to right-size the seed; see ops-knowledge
 * `plants-output-mix-invariants`.
 */
export const PLANNED_ECONOMY_MEDIA_SUPPLY_FACTOR = 0.25;

/**
 * Share of a MARKET economy's media output that reaches the advertising market.
 *
 * Same seeding problem as the bloc, minus the command-economy angle: media
 * nameplate is roughly 20x what any advertising market absorbs. Prod turn 120,
 * after the bloc re-point removed 57% of world supply, still read 2,705,394
 * supply against 136,553 demand — 19.8x, price 0.68 against an era base of 2.15,
 * i.e. still pinned to the 0.32x deflation clamp.
 *
 * Ownership offers no lever here: Western media corps ("Metro News", "Prime
 * Media") are ordinary seeded corps with real ObjectIds and no `countryOwnerId`,
 * indistinguishable from a player's. And the output mix cannot help either —
 * `commodityMixWeight` is 1 for a single-commodity mix whatever the rate, so
 * capacity is the only term. Derating the market contribution is the reversible
 * form of right-sizing it.
 *
 * This RAISES media revenue rather than cutting it, which is counterintuitive
 * enough to be worth stating: those sectors currently clear about 2% of output
 * at a third of base price, so realized value is ~0.006 of nameplate. At 0.10
 * of nameplate clearing near fully at a recovered price it is ~0.10 — an order
 * of magnitude better. The glut is what is impoverishing them.
 *
 * 0.10 is deliberately a step, not a landing: it takes world advertising to
 * roughly 2x rather than straight to balance, so the price move can be soaked
 * before tuning further. Proper fix is to right-size the seed; see ops-knowledge
 * `plants-output-mix-invariants`.
 */
export const MARKET_ECONOMY_MEDIA_SUPPLY_FACTOR = 0.1;

/**
 * True only for the news and broadcast media lane. A canonical `media` row with
 * the `entertainment` discriminator keeps the entertainment economics it had as
 * a legacy `entertainment` row, so the media derate and the planned-economy
 * advertising remap never reach it. The discriminator is a required argument at
 * every call site so the ledger and the clearing offer cannot drift apart.
 */
export function isNewsMediaLane(
  sectorType: string,
  mediaDiscriminator: string | null | undefined
): boolean {
  return getOperatingSectorType(sectorType, undefined, mediaDiscriminator) === "media";
}

/** The derate for one sector: 1 for everything outside the news media lane. */
export function plannedEconomyMediaSupplyFactor(
  sectorType: CorporationType,
  plannedEconomy: boolean,
  mediaDiscriminator: string | null | undefined
): number {
  if (!isNewsMediaLane(sectorType, mediaDiscriminator)) return 1;
  return plannedEconomy ? PLANNED_ECONOMY_MEDIA_SUPPLY_FACTOR : MARKET_ECONOMY_MEDIA_SUPPLY_FACTOR;
}
