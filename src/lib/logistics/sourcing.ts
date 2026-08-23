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
 * spare, and the origin state's shared freight capacity. Intra-state fill is
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
import {
  FREIGHT_CLASS_BY_COMMODITY,
  isHauledClass,
  SHIPPED_COMMODITIES,
  type FreightClass,
} from "./freightClass";

// ── Tuning constants (dark-ledger calibrated; money wiring still off) ────────

/**
 * Freight (TEU) consumed per commodity unit per state-line crossing, by class.
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
  // Grid rides wire and pipe, not the haulage fleet: it never spends TEU.
  // Distance is paid in transmission loss and a wheeling charge instead.
  grid: 0,
};

/**
 * Price weight per commodity unit per state-line crossing, by class.
 *
 * This deliberately remains at the original v1 calibration while
 * {@link FREIGHT_TEU_PER_UNIT_HOP} keeps ticket #1039's 10x capacity weight.
 * The two signals measure different things: the capacity weight makes a haul
 * visible on the Logistics map, while this weight converts the freight-market
 * price into a shipping charge buyers can compare with the cargo price.
 * Coupling them made the capacity calibration multiply every shipping bill by
 * ten and priced low-value cargo out before the network could become capacity
 * bound (production market audit, turn 322).
 */
export const FREIGHT_PRICE_TEU_PER_UNIT_HOP: Record<FreightClass, number> = {
  bulk: 0.004,
  special: 0.012,
  grid: 0,
};

/**
 * Fraction of dispatched units lost per hop on the grid/pipeline network:
 * resistive line loss on the wire, compressor fuel on the pipe. This is what
 * makes grid distance real without a hard capacity ceiling, so a state can
 * always import power at a price rather than being told no.
 *
 * 3%/hop puts a six-hop haul at ~17% loss, which is punitive enough that
 * generating near load still wins and cross-continent wheeling stays a
 * last resort.
 */
export const GRID_LOSS_PER_HOP = 0.03;

/**
 * Wheeling charge per hop as a fraction of the seller's ask. The grid operator
 * is not the trucking market, so grid legs must not be priced off the `freight`
 * commodity: a freight price spike has no business making the lights more
 * expensive. Small per hop, but it still puts distant generation behind local
 * generation in the landed-price sort, which is the ordering we want.
 */
export const GRID_WHEELING_PER_HOP_FRACTION = 0.02;

/**
 * How far a state's haulage may be pushed past its nominal shared capacity
 * before nothing more moves, and what the overflow costs.
 *
 * The capacity gate used to be a hard wall: once a state's freight capacity ran
 * dry, the remaining units simply did not ship and the seller ate them with no
 * signal. Measured on prod at t225 that wall was a large part of why 60.4% of
 * world production sat in a state that did not need it while 28.7% of world
 * demand went unmet. Freight should be a COST, not a wall (owner decision
 * 2026-08-19): past nominal capacity the network still moves goods, at a
 * surcharge that rises with how far past capacity it is being pushed, and the
 * buyer's tolerance ceiling is what finally stops the flow. That keeps a real
 * economic limit on long hauls while removing the silent hard stop.
 */
export const FREIGHT_CONGESTION_OVERFLOW = 0.5;
/**
 * Surcharge on the shipping leg for units moving above nominal capacity.
 *
 * Sized against BUYER_TOLERANCE_SLACK (0.35 of the whole landed price): a
 * surcharge on the shipping LEG alone at this rate stays well inside the
 * buyer's tolerance for a short haul and prices itself out on a long one,
 * which is the behaviour we want. Deliberately not 1.0: at a full doubling of
 * the shipping leg almost no real route clears the ceiling, and a congestion
 * price that never clears is just the old wall with extra steps.
 */
export const FREIGHT_CONGESTION_SURCHARGE = 0.35;

/**
 * Landed price for a haul whose units move above nominal capacity. The pass
 * charges the surcharge only on the overflow units, so this is the price the
 * ceiling test uses to decide whether overflow may happen at all.
 */
export function congestedLandedPrice(landed: number, shippingPerUnit: number): number {
  return landed + shippingPerUnit * FREIGHT_CONGESTION_SURCHARGE;
}

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

/** Freight-price weight per commodity unit per hop on the era unit basis. */
export function freightPriceTeuPerUnitHop(
  freightClass: FreightClass,
  eraUnitScale: number = 1
): number {
  void eraUnitScale;
  return FREIGHT_PRICE_TEU_PER_UNIT_HOP[freightClass];
}

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
  /** Units that could not ship because the origin state's shared freight capacity ran dry. */
  capacityBoundUnits: number;
  /** Units that shipped only by pushing a state's network past nominal capacity. */
  congestionUnits: number;
  /** Extra shipping charge those overflow units paid. */
  congestionSurchargePaid: number;
  /** Units dispatched on the grid that never arrived (transmission loss). */
  gridLossUnits: number;
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
  /**
   * Per commodity, per state: the state's OWN production that found no buyer
   * anywhere: what is left of its spare after local fill, every interstate
   * haul it could pay for, and the congestion overflow.
   *
   * This is the working spare the fill loop consumes, read at the end, so it
   * is exact. It CANNOT be reconstructed from `flows`: grid legs lose units in
   * transit, so delivered != dispatched and the arithmetic does not close.
   *
   * The sell side needs this number. Clearing is country-scoped while freight
   * settles state by state, and with neither side knowing about the other a
   * seller is credited with output no network could ever deliver: measured on
   * prod at t225, 60.4% of world production was made in a state that did not
   * need it while 28.7% of world demand went unmet.
   */
  unplacedSupplyByState: Map<CommodityType, Map<string, number>>;
  /**
   * The share of {@link unplacedSupplyByState} that failed for a DELIVERY
   * reason rather than because nobody wanted the goods.
   *
   * Spare left over when the pass ends means one of two very different things,
   * and a player needs them told apart: "the market is full" says cut output,
   * "it could not get there" says build freight. The test is whether any buyer
   * is still short at the end of the pass. Residual unmet demand and unsold
   * spare coexisting is the definition of a delivery failure, whatever stopped
   * the haul (tolerance ceiling, shared freight capacity, embargo, no route).
   *
   * Attributed proportionally and uniformly across the commodity's sellers:
   * `min(1, residualUnmet / totalSpare)` of every state's spare. Per-flow
   * origin blame is not available (a buyer's shortfall is not attributable to
   * one seller), and a uniform share is honest about that rather than
   * inventing precision.
   */
  deliveryLimitedSupplyByState: Map<CommodityType, Map<string, number>>;
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

  // Freight is one fungible fleet. Bulk and special record different TEU rates,
  // but they draw from the same state capacity instead of reserving idle slices
  // that make freight look oversupplied while one cargo class cannot move.
  const freightCapacityByState = new Map<string, number>();
  const freightUsedByState = new Map<string, Record<FreightClass, number>>();
  for (const { stateId } of sortedStates) {
    const freightSupply = byState.get(stateId)?.get("freight")?.supply ?? 0;
    freightCapacityByState.set(stateId, freightSupply);
    freightUsedByState.set(stateId, { bulk: 0, special: 0, grid: 0 });
  }

  const flows: SourcingFlow[] = [];
  const summaries: SourcingCommoditySummary[] = [];
  const landedPremiumByDestState = new Map<string, Map<CommodityType, LandedPremiumAccumulator>>();
  const importAggregatesByCountry = new Map<string, ImportAggregate>();
  const unplacedSupplyByState = new Map<CommodityType, Map<string, number>>();
  const deliveryLimitedSupplyByState = new Map<CommodityType, Map<string, number>>();

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
    const priceTeuPerUnitHop = freightPriceTeuPerUnitHop(freightClass, eraUnitScale);
    const isGrid = freightClass === "grid";
    // Haulage legs are priced off the freight market; grid legs are wheeled at
    // a fraction of the ask, because a trucking price spike has no business
    // moving the cost of electricity.
    const shippingPerUnitPerHop = freightPrice * priceTeuPerUnitHop;
    const gridWheelingPerHop = (ask: number) => ask * GRID_WHEELING_PER_HOP_FRACTION;
    /** Share of dispatched units that survive `hopCount` hops on the grid. */
    const gridDeliveryFactor = (hopCount: number) =>
      isGrid ? Math.max(0, Math.pow(1 - GRID_LOSS_PER_HOP, hopCount)) : 1;
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
      congestionUnits: 0,
      congestionSurchargePaid: 0,
      gridLossUnits: 0,
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
        const shippingPerUnit = isGrid
          ? gridWheelingPerHop(ask) * hopCount * routeMultiplier
          : shippingPerUnitPerHop * hopCount * routeMultiplier;
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
        const shippingPerUnit = isGrid
          ? gridWheelingPerHop(ask) * SEA_FREIGHT_HOP_EQUIV
          : shippingPerUnitPerHop * SEA_FREIGHT_HOP_EQUIV;
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

        // Grid legs lose a share of what they dispatch, so the buyer's fill and
        // the seller's drawdown are two different numbers. `deliver` is what
        // lands, `dispatch` is what leaves.
        const deliveryFactor = gridDeliveryFactor(cand.hopCount);
        let deliver = Math.min(unmet, spare * deliveryFactor);
        let dispatch = deliveryFactor > 0 ? deliver / deliveryFactor : 0;
        let teuConsumed = 0;
        let overflowDispatch = 0;
        let congestionSurchargePaid = 0;
        if (cand.originType === "state" && isHauledClass(freightClass)) {
          // Origin-state capacity gate (plan open question 4: v1 charges the
          // whole route to the origin's network). Past nominal capacity the
          // haul still runs, at a congestion surcharge on the overflow units
          // only, up to the overflow limit: freight is a cost, not a wall.
          const nominal = freightCapacityByState.get(cand.originId) ?? 0;
          const used = freightUsedByState.get(cand.originId)!;
          const totalUsed = used.bulk + used.special;
          const teuPerUnit = teuPerUnitHop * cand.hopCount;
          if (teuPerUnit > 0) {
            if (!(nominal > 0)) {
              // A state with no freight supply at all hauls nothing.
              summary.capacityBoundUnits += deliver;
              continue;
            }
            const unitsToNominal = Math.max(0, nominal - totalUsed) / teuPerUnit;
            const unitsInOverflow =
              Math.max(
                0,
                nominal * (1 + FREIGHT_CONGESTION_OVERFLOW) - Math.max(totalUsed, nominal)
              ) / teuPerUnit;
            // Overflow units carry the full surcharge. If that price breaks the
            // buyer's tolerance the overflow simply does not happen, which is a
            // tolerance outcome rather than a hard capacity wall.
            const congestedLanded = congestedLandedPrice(cand.landed, cand.shippingPerUnit);
            const overflowAffordable = congestedLanded <= ceiling;
            const dispatchCeiling = unitsToNominal + (overflowAffordable ? unitsInOverflow : 0);
            if (dispatchCeiling <= 0) {
              summary.capacityBoundUnits += deliver;
              continue;
            }
            if (dispatch > dispatchCeiling) {
              const lost = (dispatch - dispatchCeiling) * deliveryFactor;
              if (overflowAffordable) summary.capacityBoundUnits += lost;
              else summary.toleranceBoundUnits += lost;
              dispatch = dispatchCeiling;
              deliver = dispatch * deliveryFactor;
            }
            if (dispatch <= 0) continue;
            overflowDispatch = Math.max(0, dispatch - unitsToNominal);
            congestionSurchargePaid =
              overflowDispatch * cand.shippingPerUnit * FREIGHT_CONGESTION_SURCHARGE;
            teuConsumed = dispatch * teuPerUnit;
            used[freightClass] += teuConsumed;
          }
        }
        if (deliver <= 0) continue;
        const take = deliver;
        summary.gridLossUnits += Math.max(0, dispatch - deliver);
        summary.congestionUnits += overflowDispatch * deliveryFactor;
        summary.congestionSurchargePaid += congestionSurchargePaid;

        const tariffPaid = dispatch * cand.ask * (cand.tariffRatePct / 100);
        if (cand.originType === "state") {
          spareByState.set(cand.originId, spare - dispatch);
          summary.interStateUnits += take;
        } else {
          spareByCountry.set(cand.originId as CountryId, spare - dispatch);
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

    // Every buyer has been offered every seller, so whatever is still spare is
    // production this turn's network could not place: no local demand, no haul
    // inside the buyer's tolerance, no importer. Snapshot it before the working
    // map goes out of scope. It is the only exact record of the sell side of
    // the freight seam. Kept unrounded; the price turn rounds on persist.
    unplacedSupplyByState.set(commodity, new Map(spareByState));

    // Split that spare by REASON. `summary.unmetUnits` is still unrounded here
    // and holds every buyer's residual shortfall, so spare with no residual
    // unmet demand against it is a plain glut: the goods reached everyone who
    // wanted them and stopped because want stopped. Spare standing against
    // residual unmet demand is the seam this whole pass exists to measure.
    const totalSpare = [...spareByState.values()].reduce((sum, spare) => sum + spare, 0);
    const deliveryShare =
      totalSpare > 0 ? Math.min(1, Math.max(0, summary.unmetUnits) / totalSpare) : 0;
    const deliveryLimited = new Map<string, number>();
    for (const [stateId, spare] of spareByState) {
      deliveryLimited.set(stateId, spare * deliveryShare);
    }
    deliveryLimitedSupplyByState.set(commodity, deliveryLimited);

    summary.intraStateUnits = round2(summary.intraStateUnits);
    summary.interStateUnits = round2(summary.interStateUnits);
    summary.importUnits = round2(summary.importUnits);
    summary.tariffPaid = round2(summary.tariffPaid);
    summary.unmetUnits = round2(summary.unmetUnits);
    summary.toleranceBoundUnits = round2(summary.toleranceBoundUnits);
    summary.capacityBoundUnits = round2(summary.capacityBoundUnits);
    summary.congestionUnits = round2(summary.congestionUnits);
    summary.congestionSurchargePaid = round2(summary.congestionSurchargePaid);
    summary.gridLossUnits = round2(summary.gridLossUnits);
    summaries.push(summary);
  }

  return {
    flows,
    summaries,
    freightTeuByState: freightUsedByState,
    landedPremiumByDestState,
    importAggregatesByCountry,
    unplacedSupplyByState,
    deliveryLimitedSupplyByState,
  };
}
