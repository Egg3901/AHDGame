/**
 * Geographic market-access visibility (#968 delivered price + route mix, #991
 * resident-vs-local-producer demand, #992 stock-vs-flow kind inventory).
 *
 * The landed-price sourcing pass already computes all of this and persists it
 * (see `runSourcingPass` in logistics/sourcing.ts and the `sourcingNetworkLoad`
 * / `commoditySourcingFlows` docs it writes), and the market-formation snapshot
 * already splits resident demand from the demand a local producer can contest.
 * Until now none of it reached a reader: no symbol carried a delivered price or
 * a route, and `reconciliation.stockVsFlowByKind` sat unread on the snapshot.
 *
 * This module is PURE: plain data in, plain data out. It never touches the db,
 * the clock, the environment, or randomness — the API shell loads the persisted
 * docs and hands them here. Missing inputs become null, never a fabricated
 * zero, so an unmeasured commodity is distinguishable from a free one.
 */

import type { CommodityType } from "@/lib/constants/commodities";
import type { MarketFormationSnapshot } from "@/lib/db/types/marketFormation";
import type { StockVsFlowByKind } from "@/lib/ledger/types";
import type { CommoditySourcingDoc, SourcingNetworkDoc } from "@/lib/logistics/sourcingLedger";

/** Default number of origin→destination routes returned by the route mix. */
export const DEFAULT_TOP_ROUTES = 10;
/** Default number of stock-vs-flow kinds returned in the divergence summary. */
export const DEFAULT_TOP_STOCK_VS_FLOW_KINDS = 5;

/** One commodity's delivered-price reading for the turn. */
export interface DeliveredPriceSummary {
  commodity: CommodityType;
  /** Last turn's stored global price, the anchor a landed premium is added to. */
  globalPriceAnchor: number | null;
  /** Seeded base price, the denominator of {@link deliveredToBaseMultiple}. */
  basePrice: number | null;
  /**
   * Mean per-unit landed premium (shipping + tariff over the local ask) across
   * buyer states that recorded one. The network doc omits zero premiums, so
   * when it ran this turn and reports none the premium is 0 (delivered at the
   * anchor); when the network doc is absent entirely it is null, not 0.
   */
  landedPremiumPerUnit: number | null;
  /** Global anchor plus the landed premium: what a unit delivered from out of state cost. */
  deliveredPricePerUnit: number | null;
  /** Delivered price over the seeded base price — how far above cost deliveries trade. */
  deliveredToBaseMultiple: number | null;
  /**
   * Total freight billing money for the commodity, summed across buyer states.
   * Null when this turn wrote no billing fields (canonical billing off / older
   * doc), which is unmeasured, not a zero charge.
   */
  freightChargeAnchor: number | null;
  /** Buyer states reporting a positive premium — the sample behind the mean. */
  premiumStates: number;
}

/** Delivered-units mix across the three sourcing channels. */
export interface RouteMix {
  intraStateUnits: number;
  interstateUnits: number;
  importUnits: number;
  /** intra-state + interstate + import units actually delivered. */
  deliveredUnits: number;
  intraStateShare: number | null;
  interstateShare: number | null;
  importShare: number | null;
}

/** One origin→destination route, summed across commodities. */
export interface TopRoute {
  originType: "state" | "country";
  originId: string;
  destStateId: string;
  units: number;
}

/** Resident demand vs the share of it a local producer can contest (#991). */
export interface ResidentDemandSplit {
  statesObserved: number;
  totalResidentDemandValue: number;
  totalLocalProducerDemandValue: number;
  medianResidentDemandValue: number | null;
  medianLocalProducerDemandValue: number | null;
  /** localProducerDemandValue / residentDemandValue: demand not already served inbound. */
  localAbsorptionShare: number | null;
}

/** One divergent account kind in the stock-vs-flow inventory (#992). */
export interface StockVsFlowKindRow {
  kind: string;
  divergentCount: number;
  absDivergence: number;
  uninstrumentedCount: number;
}

/** Ranked stock-vs-flow divergence inventory (#992). */
export interface StockVsFlowDivergenceSummary {
  totalDivergentCount: number;
  totalAbsDivergence: number;
  /** Kinds ranked by |divergence| descending. */
  topKinds: StockVsFlowKindRow[];
}

/** Full market-access visibility view for one turn. */
export interface MarketAccessVisibility {
  deliveredPrice: DeliveredPriceSummary[];
  routeMix: RouteMix;
  topRoutes: TopRoute[];
  /** Null when no market-formation snapshot was supplied: unmeasured, not zero. */
  residentDemandSplit: ResidentDemandSplit | null;
}

export interface MarketAccessVisibilityInputs {
  /** Lagged global price per commodity (`commodityPrices.globalPrice`). */
  globalPrices?: Partial<Record<CommodityType, number>>;
  /** Seeded base price per commodity (`commodityPrices.basePrice`). */
  basePrices?: Partial<Record<CommodityType, number>>;
  /** The turn's persisted sourcing network doc, or null before the first run. */
  network?: SourcingNetworkDoc | null;
  /** The turn's persisted per-commodity sourcing docs (route mix + flows). */
  commodityDocs?: readonly CommoditySourcingDoc[];
  /** The turn's market-formation snapshot, or null when none exists. */
  marketFormation?: MarketFormationSnapshot | null;
  /** How many top origin→destination routes to return. Defaults to 10. */
  topRouteLimit?: number;
}

const finite = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

const nonnegative = (value: unknown): number => (finite(value) && value > 0 ? value : 0);

function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1]! + sorted[middle]!) / 2 : sorted[middle]!;
}

function ratio(numerator: number, denominator: number): number | null {
  return denominator > 0 ? numerator / denominator : null;
}

/** Every commodity any input mentions, deterministically ordered. */
function observedCommodities(inputs: MarketAccessVisibilityInputs): CommodityType[] {
  const commodities = new Set<CommodityType>();
  for (const commodity of Object.keys(inputs.globalPrices ?? {})) {
    commodities.add(commodity as CommodityType);
  }
  for (const doc of inputs.commodityDocs ?? []) commodities.add(doc.commodity);
  if (inputs.network?.landedPremiums) {
    for (const byCommodity of Object.values(inputs.network.landedPremiums)) {
      for (const commodity of Object.keys(byCommodity)) commodities.add(commodity as CommodityType);
    }
  }
  if (inputs.network?.freightCharges) {
    for (const byCommodity of Object.values(inputs.network.freightCharges)) {
      for (const commodity of Object.keys(byCommodity)) commodities.add(commodity as CommodityType);
    }
  }
  return [...commodities].sort();
}

function deliveredPriceSummaries(inputs: MarketAccessVisibilityInputs): DeliveredPriceSummary[] {
  const network = inputs.network ?? null;
  const globalPrices = inputs.globalPrices ?? {};
  const basePrices = inputs.basePrices ?? {};

  const premiumByCommodity = new Map<CommodityType, number[]>();
  if (network?.landedPremiums) {
    for (const byCommodity of Object.values(network.landedPremiums)) {
      for (const [commodity, premium] of Object.entries(byCommodity) as [CommodityType, number][]) {
        if (!(finite(premium) && premium > 0)) continue;
        const list = premiumByCommodity.get(commodity) ?? [];
        list.push(premium);
        premiumByCommodity.set(commodity, list);
      }
    }
  }

  // `freightCharges` is written only while canonical billing is on. An absent
  // field is unmeasured (null); a present field with no entry for a commodity
  // is a genuine zero charge.
  const billingRecorded = network?.freightCharges != null;
  const freightChargeByCommodity = new Map<CommodityType, number>();
  if (network?.freightCharges) {
    for (const byCommodity of Object.values(network.freightCharges)) {
      for (const [commodity, charge] of Object.entries(byCommodity) as [CommodityType, number][]) {
        if (!finite(charge)) continue;
        freightChargeByCommodity.set(
          commodity,
          (freightChargeByCommodity.get(commodity) ?? 0) + charge
        );
      }
    }
  }

  return observedCommodities(inputs).map((commodity) => {
    const globalPrice = globalPrices[commodity];
    const globalPriceAnchor = finite(globalPrice) ? globalPrice : null;
    const basePrice = basePrices[commodity];
    const basePriceAnchor = finite(basePrice) && basePrice > 0 ? basePrice : null;

    const premiums = premiumByCommodity.get(commodity) ?? [];
    // A present network doc that recorded no positive premium means deliveries
    // ran at the anchor (premium 0); an absent doc left the premium unmeasured.
    const landedPremiumPerUnit = network?.landedPremiums == null ? null : (mean(premiums) ?? 0);
    // A delivered price needs BOTH a price anchor and a measured premium; a
    // missing premium is unknown, not a free delivery.
    const deliveredPricePerUnit =
      globalPriceAnchor == null || landedPremiumPerUnit == null
        ? null
        : globalPriceAnchor + landedPremiumPerUnit;
    const deliveredToBaseMultiple =
      deliveredPricePerUnit != null && basePriceAnchor != null
        ? deliveredPricePerUnit / basePriceAnchor
        : null;

    return {
      commodity,
      globalPriceAnchor,
      basePrice: basePriceAnchor,
      landedPremiumPerUnit,
      deliveredPricePerUnit,
      deliveredToBaseMultiple,
      freightChargeAnchor: billingRecorded ? (freightChargeByCommodity.get(commodity) ?? 0) : null,
      premiumStates: premiums.length,
    };
  });
}

function buildRouteMix(docs: readonly CommoditySourcingDoc[]): RouteMix {
  let intraStateUnits = 0;
  let interstateUnits = 0;
  let importUnits = 0;
  for (const doc of docs) {
    intraStateUnits += nonnegative(doc.intraStateUnits);
    interstateUnits += nonnegative(doc.interStateUnits);
    importUnits += nonnegative(doc.importUnits);
  }
  const deliveredUnits = intraStateUnits + interstateUnits + importUnits;
  return {
    intraStateUnits,
    interstateUnits,
    importUnits,
    deliveredUnits,
    intraStateShare: ratio(intraStateUnits, deliveredUnits),
    interstateShare: ratio(interstateUnits, deliveredUnits),
    importShare: ratio(importUnits, deliveredUnits),
  };
}

function buildTopRoutes(docs: readonly CommoditySourcingDoc[], limit: number): TopRoute[] {
  const byRoute = new Map<string, TopRoute>();
  for (const doc of docs) {
    for (const flow of doc.flows ?? []) {
      const units = nonnegative(flow.units);
      if (units <= 0) continue;
      const key = `${flow.originType}\u0000${flow.originId}\u0000${flow.destStateId}`;
      const row = byRoute.get(key) ?? {
        originType: flow.originType,
        originId: flow.originId,
        destStateId: flow.destStateId,
        units: 0,
      };
      row.units += units;
      byRoute.set(key, row);
    }
  }
  const boundedLimit = Math.max(1, Math.floor(limit));
  return [...byRoute.values()]
    .sort(
      (a, b) =>
        b.units - a.units ||
        a.originId.localeCompare(b.originId) ||
        a.destStateId.localeCompare(b.destStateId)
    )
    .slice(0, boundedLimit);
}

/**
 * Resident demand vs the demand a local producer can contest, rolled up across
 * the snapshot's observed states. Null when there is no snapshot to read:
 * "no evidence" and "no demand" are different claims.
 */
export function summarizeResidentDemandSplit(
  marketFormation: Pick<MarketFormationSnapshot, "coverageByState"> | null | undefined
): ResidentDemandSplit | null {
  const rows = marketFormation?.coverageByState;
  if (!rows || rows.length === 0) return null;
  const resident = rows.map((row) => nonnegative(row.residentDemandValue));
  const localProducer = rows.map((row) => nonnegative(row.localProducerDemandValue));
  const totalResidentDemandValue = resident.reduce((sum, value) => sum + value, 0);
  const totalLocalProducerDemandValue = localProducer.reduce((sum, value) => sum + value, 0);
  return {
    statesObserved: rows.length,
    totalResidentDemandValue,
    totalLocalProducerDemandValue,
    medianResidentDemandValue: median(resident),
    medianLocalProducerDemandValue: median(localProducer),
    localAbsorptionShare: ratio(totalLocalProducerDemandValue, totalResidentDemandValue),
  };
}

/**
 * Roll the reconciliation report's full per-kind stock-vs-flow inventory into
 * the top kinds by |divergence| plus the total divergent count (#992). Null when
 * no inventory was recorded (the check was skipped): unknown, not zero.
 */
export function summarizeStockVsFlowDivergence(
  byKind: readonly StockVsFlowByKind[] | null | undefined,
  topLimit: number = DEFAULT_TOP_STOCK_VS_FLOW_KINDS
): StockVsFlowDivergenceSummary | null {
  if (!byKind) return null;
  const rows: StockVsFlowKindRow[] = byKind.map((row) => ({
    kind: row.kind,
    divergentCount: finite(row.divergentCount) ? Math.max(0, Math.floor(row.divergentCount)) : 0,
    absDivergence: finite(row.absDivergence) ? Math.abs(row.absDivergence) : 0,
    uninstrumentedCount: finite(row.uninstrumentedCount)
      ? Math.max(0, Math.floor(row.uninstrumentedCount))
      : 0,
  }));
  const boundedLimit = Math.max(1, Math.floor(topLimit));
  return {
    totalDivergentCount: rows.reduce((sum, row) => sum + row.divergentCount, 0),
    totalAbsDivergence: rows.reduce((sum, row) => sum + row.absDivergence, 0),
    topKinds: [...rows]
      .sort((a, b) => b.absDivergence - a.absDivergence || a.kind.localeCompare(b.kind))
      .slice(0, boundedLimit),
  };
}

/** Compute the full market-access visibility view from persisted plain inputs. */
export function computeMarketAccessVisibility(
  inputs: MarketAccessVisibilityInputs
): MarketAccessVisibility {
  const docs = inputs.commodityDocs ?? [];
  return {
    deliveredPrice: deliveredPriceSummaries(inputs),
    routeMix: buildRouteMix(docs),
    topRoutes: buildTopRoutes(docs, inputs.topRouteLimit ?? DEFAULT_TOP_ROUTES),
    residentDemandSplit: summarizeResidentDemandSplit(inputs.marketFormation),
  };
}
