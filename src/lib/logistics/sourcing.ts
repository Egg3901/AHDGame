/**
 * Landed-price sourcing pass — RECORD-ONLY (interstate-logistics plan Rev 4,
 * build-order step 3).
 *
 * For each shipped commodity, each state with unmet local demand ranks every
 * candidate seller (same-country states with spare supply, plus foreign
 * countries with national spare) by landed price:
 *
 *   landed = seller's ask + shipping (per hop, by freight class) + tariff
 *
 * and fills cheapest-first up to the buyer's tolerance ceiling, the seller's
 * spare, and the origin state's per-class freight capacity. Intra-state fill is
 * free and consumes no capacity.
 *
 * This pass MUTATES NOTHING in the price model. It reads copies of the state
 * and country balances and returns a flow ledger; supply/demand, prices and the
 * aggregate trade clearing behave exactly as before. The ledger is observable
 * evidence for tuning the constants below before money wiring (step 5) flips on.
 *
 * Asks are LAST TURN's stored state/national prices (plan open question 1:
 * fixed asks, one pass, predictable). For planned economies the stored national
 * price already carries the administered value, so administered asks come for
 * free. Capacity is consumed in buyer fill order rather than by a global
 * least-attractive-first ordering — acceptable for a record-only v1, revisit
 * with money wiring if the dark ledger shows order artifacts.
 */

import type { CommodityType } from "@/lib/constants/commodities";
import type { CountryId } from "@/lib/constants/countries";
import { FREIGHT_CLASS_BY_COMMODITY, SHIPPED_COMMODITIES, type FreightClass } from "./freightClass";

// ── Tuning constants (dark-ledger calibrated; money wiring still off) ────────

/**
 * Freight (TEU) consumed per commodity unit per state-line crossing, by class.
 * Also the basis of the shipping charge: perUnitHopCost = freightPrice × this.
 * Special care hauls fewer goods per TEU-equivalent, hence the higher factor.
 *
 * Calibrated 10× up from the 0.004/0.012 v1 seeds (ticket #1039): live
 * sourcingNetworkLoad showed interstate haul using only ~6% of NY freight
 * supply, so the Logistics map read as a ~4 TEU state market. Commodity unit
 * counts and freight TEU supply already share {@link getEraUnitScale}, so this
 * ratio is era-invariant — see {@link freightTeuPerUnitHop}.
 */
export const FREIGHT_TEU_PER_UNIT_HOP: Record<FreightClass, number> = {
  bulk: 0.04,
  special: 0.12,
};

/**
 * TEU per commodity-unit per hop on the world's era unit basis.
 *
 * Do not divide by `eraUnitScale`: under plants, both commodity balances and
 * freight TEU supply are already on that basis, so the haul ratio stays
 * real-terms invariant across eras. `eraUnitScale` is accepted for call-site
 * symmetry with other plants helpers (and for money-wiring rates later).
 */
export function freightTeuPerUnitHop(freightClass: FreightClass, eraUnitScale: number = 1): number {
  void eraUnitScale;
  return FREIGHT_TEU_PER_UNIT_HOP[freightClass];
}

/**
 * Share of a state's freight supply available per class while `freight` is
 * still a single commodity (plan build-order step 2 splits it for real).
 */
export const FREIGHT_CLASS_CAPACITY_SHARE: Record<FreightClass, number> = {
  bulk: 0.7,
  special: 0.3,
};

/**
 * Overseas legs are priced and capacity-free as a flat hop-equivalent
 * (plan open question 3: flat sea freight first; no origin-state network is
 * modeled for foreign sellers, so imports consume no domestic capacity).
 */
export const SEA_FREIGHT_HOP_EQUIV = 6;

/**
 * Fallback hop distance when two same-country states have no adjacency route
 * (e.g. HI): treated like a sea leg.
 */
export const UNREACHABLE_HOP_EQUIV = SEA_FREIGHT_HOP_EQUIV;

/**
 * Buyer tolerance ceiling = local state price × (1 + slack). Above it, demand
 * goes unmet and the shortage feeds back through prices next turn.
 */
export const BUYER_TOLERANCE_SLACK = 0.35;

/** Flows below this many units are summed into the doc totals but not itemized. */
export const FLOW_RECORD_FLOOR_UNITS = 1;

// ── Types ────────────────────────────────────────────────────────────────────

export interface SourcingFlow {
  commodity: CommodityType;
  /** "state" = same-country interstate seller; "country" = foreign import. */
  originType: "state" | "country";
  originId: string;
  destStateId: string;
  units: number;
  /** 0 for intra-state; SEA_FREIGHT_HOP_EQUIV for overseas. */
  hops: number;
  freightClass: FreightClass;
  ask: number;
  shippingPerUnit: number;
  tariffRatePct: number;
  tariffPaid: number;
  landedPrice: number;
  /** Domestic origin-state freight capacity consumed (TEU); 0 for imports. */
  freightTeuConsumed: number;
}

export interface SourcingCommoditySummary {
  commodity: CommodityType;
  intraStateUnits: number;
  interStateUnits: number;
  importUnits: number;
  tariffPaid: number;
  /** Demand still unmet after local fill + sourcing (tolerance/capacity/supply bound). */
  unmetUnits: number;
  /** Units that could not ship because a seller's landed price broke the ceiling. */
  toleranceBoundUnits: number;
  /** Units that could not ship because the origin state's class capacity ran dry. */
  capacityBoundUnits: number;
}

/** Delivered units and the extra-cost-over-local-price they carried, for a state/commodity. */
export interface LandedPremiumAccumulator {
  metUnits: number;
  extraCost: number;
}

/** Per-buyer-country import totals (for tariff-revenue and import-value reporting). */
export interface ImportAggregate {
  tariffPaid: number;
  importValue: number;
}

export interface SourcingResult {
  flows: SourcingFlow[];
  summaries: SourcingCommoditySummary[];
  /** TEU consumed per state per class — the load on each shipping network. */
  freightTeuByState: Map<string, Record<FreightClass, number>>;
  /**
   * Per destination state, per commodity: units actually delivered (local fill
   * plus interstate plus import) and the extra cost over local ask those units
   * carried (shipping plus tariff; zero for local fill). Money wiring (step 5)
   * divides extraCost by metUnits to get the per-unit landed premium a buyer in
   * that state pays for out-of-state sourcing.
   */
  landedPremiumByDestState: Map<string, Map<CommodityType, LandedPremiumAccumulator>>;
  /**
   * Per buyer country: total tariff paid and total import value (units × ask)
   * across all import flows into that country this turn.
   */
  importAggregatesByCountry: Map<string, ImportAggregate>;
}

type Balance = { supply: number; demand: number };

export interface SourcingInputs {
  /** Non-national-scope states with their country. */
  states: ReadonlyArray<{ stateId: string; countryId: CountryId }>;
  /** Per-state balances (read-only; the pass copies what it consumes). */
  byState: ReadonlyMap<string, ReadonlyMap<CommodityType, Balance>>;
  /** Per-country balances, for foreign national spare. */
  byCountry: ReadonlyMap<string, ReadonlyMap<CommodityType, Balance>>;
  /** LAST turn's stored prices — the fixed asks. */
  statePricesFor: (commodity: CommodityType) => Readonly<Record<string, number>> | undefined;
  nationalPricesFor: (commodity: CommodityType) => Readonly<Record<string, number>> | undefined;
  /** Fallback ask/tolerance anchor when no stored price exists (first turn). */
  basePriceFor: (commodity: CommodityType) => number;
  /** Last turn's global freight price — the shipping cost basis (era-scaled). */
  freightPrice: number;
  /**
   * World's era unit-basis scale (`getEraUnitScale(preset)`). Defaults to 1.
   * TEU-per-unit rates are scale-free (see {@link freightTeuPerUnitHop}); this
   * is threaded for plants call-site symmetry and future haulage $ rates.
   */
  eraUnitScale?: number;
  /** Same-country hop distance; null = no route. */
  hops: (country: CountryId, from: string, to: string) => number | null;
  /** Optional domestic route-cost modifier. Defaults to 1. */
  shippingCostMultiplier?: (country: CountryId, from: string, to: string) => number;
  /** Importer-side tariff rate in percent for a foreign flow. */
  tariffRatePct: (commodity: CommodityType, exporter: CountryId, importer: CountryId) => number;
  /** True when an embargo blocks the directed flow exporter→importer. */
  isBlocked: (commodity: CommodityType, exporter: CountryId, importer: CountryId) => boolean;
}

// ── Pass ─────────────────────────────────────────────────────────────────────

const round2 = (n: number) => Math.round(n * 100) / 100;

export function runSourcingPass(inputs: SourcingInputs): SourcingResult {
  const {
    states,
    byState,
    byCountry,
    statePricesFor,
    nationalPricesFor,
    basePriceFor,
    freightPrice,
    eraUnitScale = 1,
    hops,
    shippingCostMultiplier,
    tariffRatePct,
    isBlocked,
  } = inputs;

  // Deterministic iteration: states sorted by id, countries sorted by id.
  const sortedStates = [...states].sort((a, b) => a.stateId.localeCompare(b.stateId));
  const countryIds = [...byCountry.keys()].sort() as CountryId[];

  // Freight capacity per state per class, from the state's freight supply.
  const freightCapByState = new Map<string, Record<FreightClass, number>>();
  const freightUsedByState = new Map<string, Record<FreightClass, number>>();
  for (const { stateId } of sortedStates) {
    const freightSupply = byState.get(stateId)?.get("freight")?.supply ?? 0;
    freightCapByState.set(stateId, {
      bulk: freightSupply * FREIGHT_CLASS_CAPACITY_SHARE.bulk,
      special: freightSupply * FREIGHT_CLASS_CAPACITY_SHARE.special,
    });
    freightUsedByState.set(stateId, { bulk: 0, special: 0 });
  }

  const flows: SourcingFlow[] = [];
  const summaries: SourcingCommoditySummary[] = [];
  const landedPremiumByDestState = new Map<string, Map<CommodityType, LandedPremiumAccumulator>>();
  const importAggregatesByCountry = new Map<string, ImportAggregate>();

  const addLandedPremium = (
    destStateId: string,
    commodity: CommodityType,
    units: number,
    extraCost: number
  ) => {
    if (units <= 0) return;
    let byCommodity = landedPremiumByDestState.get(destStateId);
    if (!byCommodity) {
      byCommodity = new Map();
      landedPremiumByDestState.set(destStateId, byCommodity);
    }
    const acc = byCommodity.get(commodity) ?? { metUnits: 0, extraCost: 0 };
    acc.metUnits += units;
    acc.extraCost += extraCost;
    byCommodity.set(commodity, acc);
  };

  for (const commodity of SHIPPED_COMMODITIES) {
    const freightClass = FREIGHT_CLASS_BY_COMMODITY[commodity]!;
    const teuPerUnitHop = freightTeuPerUnitHop(freightClass, eraUnitScale);
    const shippingPerUnitPerHop = freightPrice * teuPerUnitHop;
    const basePrice = basePriceFor(commodity);
    const statePrices = statePricesFor(commodity) ?? {};
    const nationalPrices = nationalPricesFor(commodity) ?? {};

    // Working copies of spare supply — consumed as buyers fill, never written
    // back to the price model.
    const spareByState = new Map<string, number>();
    const localFillByState = new Map<string, number>();
    const unmetByState = new Map<string, number>();
    for (const { stateId } of sortedStates) {
      const bal = byState.get(stateId)?.get(commodity);
      const supply = bal?.supply ?? 0;
      const demand = bal?.demand ?? 0;
      // Intra-state fill is free by design; only the residual trades interstate.
      const local = Math.min(supply, demand);
      localFillByState.set(stateId, local);
      spareByState.set(stateId, Math.max(0, supply - demand));
      unmetByState.set(stateId, Math.max(0, demand - supply));
      // Local fill is free: it contributes met units with zero extra cost.
      addLandedPremium(stateId, commodity, local, 0);
    }
    // Foreign national spare (a country's own interstate flows already use the
    // state-level spare above; the national pool is only offered abroad).
    const spareByCountry = new Map<CountryId, number>();
    for (const cid of countryIds) {
      const bal = byCountry.get(cid)?.get(commodity);
      spareByCountry.set(cid, Math.max(0, (bal?.supply ?? 0) - (bal?.demand ?? 0)));
    }

    const summary: SourcingCommoditySummary = {
      commodity,
      intraStateUnits: 0,
      interStateUnits: 0,
      importUnits: 0,
      tariffPaid: 0,
      unmetUnits: 0,
      toleranceBoundUnits: 0,
      capacityBoundUnits: 0,
    };
    for (const local of localFillByState.values()) summary.intraStateUnits += local;

    for (const buyer of sortedStates) {
      let unmet = unmetByState.get(buyer.stateId) ?? 0;
      if (unmet <= 0) continue;
      const buyerPrice = statePrices[buyer.stateId] ?? basePrice;
      const ceiling = buyerPrice * (1 + BUYER_TOLERANCE_SLACK);

      // Candidate sellers: same-country states with spare + foreign countries.
      type Candidate = {
        originType: "state" | "country";
        originId: string;
        landed: number;
        ask: number;
        shippingPerUnit: number;
        tariffRatePct: number;
        hopCount: number;
        /** Same-country sellers win landed-price ties. */
        domestic: boolean;
      };
      const candidates: Candidate[] = [];

      for (const seller of sortedStates) {
        if (seller.countryId !== buyer.countryId || seller.stateId === buyer.stateId) continue;
        const spare = spareByState.get(seller.stateId) ?? 0;
        if (spare <= 0) continue;
        const hopCount =
          hops(buyer.countryId, seller.stateId, buyer.stateId) ?? UNREACHABLE_HOP_EQUIV;
        if (hopCount <= 0) continue;
        const ask = statePrices[seller.stateId] ?? basePrice;
        const routeMultiplier = shippingCostMultiplier
          ? Math.max(0, shippingCostMultiplier(buyer.countryId, seller.stateId, buyer.stateId))
          : 1;
        const shippingPerUnit = shippingPerUnitPerHop * hopCount * routeMultiplier;
        candidates.push({
          originType: "state",
          originId: seller.stateId,
          landed: ask + shippingPerUnit,
          ask,
          shippingPerUnit,
          tariffRatePct: 0,
          hopCount,
          domestic: true,
        });
      }
      for (const cid of countryIds) {
        if (cid === buyer.countryId) continue;
        const spare = spareByCountry.get(cid) ?? 0;
        if (spare <= 0) continue;
        if (isBlocked(commodity, cid, buyer.countryId)) continue;
        const ask = nationalPrices[cid] ?? basePrice;
        const shippingPerUnit = shippingPerUnitPerHop * SEA_FREIGHT_HOP_EQUIV;
        const ratePct = tariffRatePct(commodity, cid, buyer.countryId);
        const tariffPerUnit = ask * (ratePct / 100);
        candidates.push({
          originType: "country",
          originId: cid,
          landed: ask + shippingPerUnit + tariffPerUnit,
          ask,
          shippingPerUnit,
          tariffRatePct: ratePct,
          hopCount: SEA_FREIGHT_HOP_EQUIV,
          domestic: false,
        });
      }

      candidates.sort(
        (a, b) =>
          a.landed - b.landed ||
          Number(b.domestic) - Number(a.domestic) ||
          a.originId.localeCompare(b.originId)
      );

      for (const cand of candidates) {
        if (unmet <= 0) break;
        if (cand.landed > ceiling) {
          // Sorted ascending: everything past here also breaks the ceiling.
          summary.toleranceBoundUnits += unmet;
          break;
        }
        const spare =
          cand.originType === "state"
            ? spareByState.get(cand.originId)!
            : spareByCountry.get(cand.originId as CountryId)!;
        if (spare <= 0) continue;

        let take = Math.min(unmet, spare);
        let teuConsumed = 0;
        if (cand.originType === "state") {
          // Origin-state capacity gate (plan open question 4: v1 charges the
          // whole route to the origin's network).
          const cap = freightCapByState.get(cand.originId)!;
          const used = freightUsedByState.get(cand.originId)!;
          const teuAvailable = cap[freightClass] - used[freightClass];
          const teuPerUnit = teuPerUnitHop * cand.hopCount;
          const shippable = teuPerUnit > 0 ? teuAvailable / teuPerUnit : take;
          if (shippable < take) {
            summary.capacityBoundUnits += take - Math.max(0, shippable);
            take = Math.max(0, shippable);
          }
          if (take <= 0) continue;
          teuConsumed = take * teuPerUnit;
          used[freightClass] += teuConsumed;
        }

        const tariffPaid = take * cand.ask * (cand.tariffRatePct / 100);
        if (cand.originType === "state") {
          spareByState.set(cand.originId, spare - take);
          summary.interStateUnits += take;
        } else {
          spareByCountry.set(cand.originId as CountryId, spare - take);
          summary.importUnits += take;
          summary.tariffPaid += tariffPaid;
        }
        unmet -= take;

        // Delivered-units + extra-cost accumulation for money wiring, regardless
        // of the itemization floor below (that floor only caps the doc's flow
        // list; the aggregates must stay exact).
        addLandedPremium(buyer.stateId, commodity, take, take * cand.shippingPerUnit + tariffPaid);
        if (cand.originType === "country") {
          const agg = importAggregatesByCountry.get(buyer.countryId) ?? {
            tariffPaid: 0,
            importValue: 0,
          };
          agg.tariffPaid += tariffPaid;
          agg.importValue += take * cand.ask;
          importAggregatesByCountry.set(buyer.countryId, agg);
        }

        if (take >= FLOW_RECORD_FLOOR_UNITS) {
          flows.push({
            commodity,
            originType: cand.originType,
            originId: cand.originId,
            destStateId: buyer.stateId,
            units: round2(take),
            hops: cand.hopCount,
            freightClass,
            ask: round2(cand.ask),
            shippingPerUnit: round2(cand.shippingPerUnit),
            tariffRatePct: cand.tariffRatePct,
            tariffPaid: round2(tariffPaid),
            landedPrice: round2(cand.landed),
            freightTeuConsumed: round2(teuConsumed),
          });
        }
      }

      summary.unmetUnits += Math.max(0, unmet);
    }

    summary.intraStateUnits = round2(summary.intraStateUnits);
    summary.interStateUnits = round2(summary.interStateUnits);
    summary.importUnits = round2(summary.importUnits);
    summary.tariffPaid = round2(summary.tariffPaid);
    summary.unmetUnits = round2(summary.unmetUnits);
    summary.toleranceBoundUnits = round2(summary.toleranceBoundUnits);
    summary.capacityBoundUnits = round2(summary.capacityBoundUnits);
    summaries.push(summary);
  }

  return {
    flows,
    summaries,
    freightTeuByState: freightUsedByState,
    landedPremiumByDestState,
    importAggregatesByCountry,
  };
}
