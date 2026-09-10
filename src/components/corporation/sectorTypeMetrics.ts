/**
 * Live KPI cells for a sector-type dossier.
 *
 * The design proposed three type-specific metrics per sector type (input
 * cover, foot traffic, loan book, audience reach, ...). Most of those describe
 * systems the game does not have, and a dossier that prints them as literals
 * is a static board wearing a live page's clothes. So every cell here resolves
 * from the sectors the corporation actually owns.
 *
 * Where the design's metric IS computable it keeps the design's label:
 * manufacturing still says "Line utilisation" and "Output mix", logistics
 * still says "Freight capacity", "Network coverage" and "Sprawl relief".
 * Where it is not, the slot is filled by the nearest live figure instead of a
 * dash, so the strip never carries a cell that means nothing.
 *
 * Money is deliberately NOT computed here. Revenue and profit are the first
 * two cells of the strip and they need the corp's currency formatter, so the
 * dossier builds them itself from the same sectors.
 */

import type { CorporationType } from "@/lib/constants/corporations";
import { getSprawlModifier } from "@/lib/constants/corporations";
import {
  COMMODITY_LABELS,
  EXTRACTABLE_RESOURCES,
  type CommodityType,
  type ExtractableResource,
} from "@/lib/constants/commodities";
import { SECTOR_STRATEGIES, getStrategy } from "@/lib/constants/sectorStrategies";
import { facilityPlural } from "@/lib/constants/facilityVocabulary";
import { formatFillPercent, formatUnits } from "./plantsPresentation";
import type { SectorDetail } from "./CorporationPageTypes";

export interface SectorTypeMetric {
  label: string;
  /** Formatted figure, or "—" when this corporation has nothing to compute it from. */
  value: string;
  /** The one-line gloss under the figure. */
  sub: string;
  /** Tooltip: what the number is and where it comes from. */
  help: string;
}

/** Everything the metrics need that does not live on a sector row. */
export interface SectorTypeMetricContext {
  /** Plants tier. Below it, capacity and fill do not exist on any sector. */
  plantsMode: boolean;
  /** Corp-wide sector count, for the sprawl figures. */
  totalSectors: number;
  logisticsStrength: number;
  hasSecondaryType: boolean;
}

// ─── Small live aggregates ──────────────────────────────────────────────────

const sum = (sectors: SectorDetail[], pick: (s: SectorDetail) => number | null | undefined) =>
  sectors.reduce((acc, s) => acc + (pick(s) ?? 0), 0);

/** Weight a per-sector rate by capacity, falling back to one vote per sector. */
function capacityWeight(sector: SectorDetail): number {
  const cap = sector.capacityUnits;
  return cap != null && Number.isFinite(cap) && cap > 0 ? cap : 1;
}

// Unit and percentage formatting come from `plantsPresentation`, the module the
// sector table and every other plants surface already formats through. These
// were local copies until an audit found them byte-identical: two formatters
// for one number is exactly how the money units drifted before moneyTimescale
// centralised them.

/** Σproduced ÷ Σcapacity. Null below plants, or when nothing has capacity. */
export function typeCapacityUsed(sectors: SectorDetail[]): number | null {
  const capacity = sum(sectors, (s) => s.capacityUnits);
  if (capacity <= 0) return null;
  return sum(sectors, (s) => s.producedUnits) / capacity;
}

/** Σsold ÷ Σproduced, the corp-fill basis the table totals already use. */
export function typeFillRate(sectors: SectorDetail[]): number | null {
  const produced = sum(sectors, (s) => s.producedUnits);
  if (produced <= 0) return null;
  return sum(sectors, (s) => s.soldUnits) / produced;
}

/** Distinct states these sectors operate in. */
export function typeStateCount(sectors: SectorDetail[]): number {
  return new Set(sectors.map((s) => s.stateId)).size;
}

/**
 * How many actual facilities these sectors carry.
 *
 * A sector is a market position in one state; under the plants tier it holds
 * `plantCount` physical sites. The design's headline sentence is "N plants in M
 * states", and counting SECTORS there would print "3 plants" for a division
 * that in fact runs twelve. Below the plants tier there are no facilities to
 * count, so each sector stands for itself.
 */
export function typeFacilityCount(sectors: SectorDetail[]): number {
  return sectors.reduce((acc, s) => acc + (s.plantCount ?? 1), 0);
}

/**
 * Capacity-weighted market share across the (state, type) buckets these
 * sectors sit in. A weighted mean rather than a plain one so a token site in a
 * market you barely touch cannot drag the headline for the plant that matters.
 */
export function typeMarketShare(sectors: SectorDetail[]): number | null {
  const weight = sectors.reduce((acc, s) => acc + capacityWeight(s), 0);
  if (weight <= 0) return null;
  const share = sectors.reduce((acc, s) => acc + s.marketSharePercent * capacityWeight(s), 0);
  return share / weight;
}

/**
 * The strategy a sector is actually running, resolved the way the ENGINE
 * resolves it.
 *
 * A stored `strategyId` can name a strategy this type no longer has (a rename,
 * a removed production method, a row that predates a rebalance). `getStrategy`
 * is the turn processor's own resolver and falls back to the type's first
 * strategy; going through it means this module, the strategy panel and the
 * engine cannot disagree about which recipe a sector is on. Rolling a private
 * fallback here is what let the panel silently drop such a sector while this
 * file still counted it.
 */
export function resolveSectorStrategy(sector: SectorDetail) {
  const type = sector.sectorType as CorporationType;
  if (!SECTOR_STRATEGIES[type]?.length) return null;
  // `corporationDetail` already normalises an absent id to "standard", so this
  // only matters for a row that arrives with one; kept so the function is
  // correct on its own terms, the same way every other caller writes it.
  return getStrategy(type, sector.strategyId ?? "standard");
}

const strategyFor = resolveSectorStrategy;

/**
 * The commodity these sites mostly make, and its share of their output.
 *
 * Read off the ACTIVE strategy of each sector, capacity weighted, so a corp
 * that moved three of its five plants onto Electronics Manufacturing sees the
 * mix move. "100% steel" means every unit these sites produce is steel, which
 * is exactly what a single-output strategy like Heavy Metals does.
 */
export function typeOutputMix(
  sectors: SectorDetail[]
): { commodity: CommodityType; share: number } | null {
  const totals = new Map<CommodityType, number>();
  let grand = 0;
  for (const sector of sectors) {
    const strategy = strategyFor(sector);
    if (!strategy) continue;
    const weight = capacityWeight(sector);
    for (const [commodity, rate] of Object.entries(strategy.supply)) {
      if (!rate) continue;
      const scaled = rate * weight;
      totals.set(
        commodity as CommodityType,
        (totals.get(commodity as CommodityType) ?? 0) + scaled
      );
      grand += scaled;
    }
  }
  if (grand <= 0) return null;
  let best: { commodity: CommodityType; share: number } | null = null;
  for (const [commodity, value] of totals) {
    if (!best || value / grand > best.share) best = { commodity, share: value / grand };
  }
  return best;
}

const FOSSIL_INPUTS: readonly CommodityType[] = ["coal", "oil", "natural_gas"];

/**
 * Share of these sites' input basket that is coal, oil or gas.
 *
 * The design asked for "fuel mix" on energy and it is the one energy metric
 * that falls straight out of the strategies: Conventional and Hydraulic
 * Fracturing buy hydrocarbons, Renewables Focus buys electronics and rare
 * earths instead.
 */
export function typeFossilShare(sectors: SectorDetail[]): number | null {
  let fossil = 0;
  let grand = 0;
  for (const sector of sectors) {
    const strategy = strategyFor(sector);
    if (!strategy) continue;
    const weight = capacityWeight(sector);
    for (const [commodity, rate] of Object.entries(strategy.demand)) {
      if (!rate) continue;
      const scaled = rate * weight;
      grand += scaled;
      if (FOSSIL_INPUTS.includes(commodity as CommodityType)) fossil += scaled;
    }
  }
  if (grand <= 0) return null;
  return fossil / grand;
}

/**
 * Extractable capacity per turn sitting under the states these mines are in.
 *
 * `stateResources` is the state's per-turn ceiling for each resource, not a
 * remaining reserve, so this is deliberately labelled "deposit capacity" and
 * not the design's "deposit remaining": the game has no depletion counter to
 * read. Counted once per state, because two mines in one state share the same
 * ground.
 */
export function typeDepositCapacity(sectors: SectorDetail[]): number | null {
  const wanted = new Set<ExtractableResource>();
  for (const sector of sectors) {
    const strategy = strategyFor(sector);
    if (!strategy) continue;
    for (const [commodity, rate] of Object.entries(strategy.supply)) {
      if (!rate) continue;
      if ((EXTRACTABLE_RESOURCES as readonly string[]).includes(commodity)) {
        wanted.add(commodity as ExtractableResource);
      }
    }
  }
  if (wanted.size === 0) return null;

  const seenStates = new Set<string>();
  let total = 0;
  let sawResourceDoc = false;
  for (const sector of sectors) {
    if (seenStates.has(sector.stateId)) continue;
    seenStates.add(sector.stateId);
    const resources = sector.stateResources;
    if (!resources) continue;
    sawResourceDoc = true;
    for (const resource of wanted) total += resources[resource] ?? 0;
  }
  return sawResourceDoc ? total : null;
}

/**
 * Percentage points of sprawl penalty the corporation's logistics strength is
 * currently buying back, at its actual sector count.
 */
export function sprawlRelief(context: SectorTypeMetricContext): number {
  const unrelieved = getSprawlModifier(context.totalSectors, 0, context.hasSecondaryType);
  const actual = getSprawlModifier(
    context.totalSectors,
    context.logisticsStrength,
    context.hasSecondaryType
  );
  return Math.abs(unrelieved) - Math.abs(actual);
}

// ─── Metric cells ───────────────────────────────────────────────────────────

type MetricKey =
  | "capacityUsed"
  | "lineUtilisation"
  | "outputMix"
  | "fuelMix"
  | "fillRate"
  | "jobs"
  | "marketShare"
  | "depositCapacity"
  | "freightCapacity"
  | "networkCoverage"
  | "sprawlRelief"
  | "growthTarget";

function buildMetric(
  key: MetricKey,
  sectors: SectorDetail[],
  type: CorporationType,
  context: SectorTypeMetricContext
): SectorTypeMetric {
  const sites = facilityPlural(type);
  switch (key) {
    case "lineUtilisation":
    case "capacityUsed": {
      const used = typeCapacityUsed(sectors);
      return {
        label: key === "lineUtilisation" ? "Line utilisation" : "Capacity used",
        value: formatFillPercent(used),
        sub: "% of capacity running",
        help: `Units these ${sites} produced last turn over the units their capacity could have made.`,
      };
    }
    case "outputMix": {
      const mix = typeOutputMix(sectors);
      return {
        label: "Output mix",
        value: mix
          ? `${Math.round(mix.share * 100)}% ${COMMODITY_LABELS[mix.commodity] ?? mix.commodity}`.toLowerCase()
          : "—",
        sub: "largest share of output",
        help: `The commodity these ${sites} mostly make, read off the operating strategy each one is running.`,
      };
    }
    case "fuelMix": {
      const fossil = typeFossilShare(sectors);
      return {
        label: "Fuel mix",
        value: fossil == null ? "—" : `${Math.round(fossil * 100)}% fossil`,
        sub: "coal, oil and gas share of inputs",
        help: `How much of what these ${sites} buy is hydrocarbon. Renewable strategies buy electronics and rare earths instead.`,
      };
    }
    case "fillRate": {
      const fill = typeFillRate(sectors);
      return {
        label: "Fill rate",
        value: formatFillPercent(fill),
        sub: "of output actually sold",
        help: `Units sold over units produced across these ${sites}. A low fill is demand or freight, never a reason to cut production.`,
      };
    }
    case "jobs": {
      const workers = sum(sectors, (s) => s.workers);
      return {
        label: "Jobs",
        value: workers > 0 ? workers.toLocaleString("en-US") : "—",
        sub: `employed across these ${sites}`,
        help: "Total employees these sectors carry.",
      };
    }
    case "marketShare": {
      const share = typeMarketShare(sectors);
      return {
        label: "Market share",
        value: share == null ? "—" : `${share.toFixed(1)}%`,
        sub: "of the markets you are in",
        help: `Capacity weighted share of each state market these ${sites} sell into.`,
      };
    }
    case "depositCapacity": {
      const capacity = typeDepositCapacity(sectors);
      return {
        label: "Deposit capacity",
        value: formatUnits(capacity),
        sub: "extractable per turn nearby",
        help: "What the states you hold mines in can yield per turn of the resources your current strategies extract. Counted once per state.",
      };
    }
    case "freightCapacity": {
      const capacity = sum(sectors, (s) => s.capacityUnits);
      return {
        label: "Freight capacity",
        value: capacity > 0 ? formatUnits(capacity) : "—",
        sub: "units per day",
        help: "Nameplate capacity of your depots, the freight the network can move each day.",
      };
    }
    case "networkCoverage": {
      const states = typeStateCount(sectors);
      return {
        label: "Network coverage",
        value: `${states} ${states === 1 ? "state" : "states"}`,
        sub: "with a depot on the ground",
        help: "States your logistics network reaches directly.",
      };
    }
    case "sprawlRelief": {
      const relief = sprawlRelief(context);
      return {
        label: "Sprawl relief",
        value: `${relief.toFixed(2)} pp`,
        sub: "of penalty bought back",
        help: "Margin your logistics strength is currently returning to every sector the corporation owns, against the penalty you would carry with no logistics at all.",
      };
    }
    case "growthTarget": {
      if (!sectors.length) return { label: "Growth target", value: "—", sub: "average", help: "" };
      const avg = sectors.reduce((acc, s) => acc + s.targetGrowthRate, 0) / sectors.length;
      return {
        label: "Growth target",
        value: `${avg.toFixed(1)}%`,
        sub: "average across these sectors",
        help: "Mean target growth rate you have set on these sectors.",
      };
    }
  }
}

/**
 * The three type-specific slots, in the order the design laid them out.
 *
 * Types the design never covered fall through to the generic trio, which is
 * live for every type there is.
 */
const PLANTS_SLOTS: Partial<Record<CorporationType, readonly MetricKey[]>> = {
  manufacturing: ["lineUtilisation", "outputMix", "jobs"],
  energy: ["capacityUsed", "fuelMix", "jobs"],
  extraction: ["depositCapacity", "outputMix", "jobs"],
  retail: ["capacityUsed", "fillRate", "marketShare"],
  financial: ["capacityUsed", "marketShare", "jobs"],
  media: ["capacityUsed", "marketShare", "jobs"],
  technology: ["capacityUsed", "outputMix", "jobs"],
  agriculture: ["capacityUsed", "fillRate", "jobs"],
  healthcare: ["capacityUsed", "fillRate", "marketShare"],
  defense: ["capacityUsed", "fillRate", "outputMix"],
  logistics: ["freightCapacity", "networkCoverage", "sprawlRelief"],
};

const PLANTS_FALLBACK: readonly MetricKey[] = ["capacityUsed", "fillRate", "jobs"];

/**
 * Below the plants tier there is no capacity and no fill on any sector, so the
 * strip shows what a growth-slider world actually has.
 */
const GROWTH_SLOTS: readonly MetricKey[] = ["growthTarget", "marketShare", "jobs"];

export function sectorTypeMetrics(
  sectors: SectorDetail[],
  type: CorporationType,
  context: SectorTypeMetricContext
): SectorTypeMetric[] {
  const keys = context.plantsMode ? (PLANTS_SLOTS[type] ?? PLANTS_FALLBACK) : GROWTH_SLOTS;
  return keys.map((key) => buildMetric(key, sectors, type, context));
}
