import { COUNTRY_ORDER } from "@/lib/constants/countries";
import type { CommodityPrice } from "@/lib/db/types";
import type { State } from "@/lib/db/types/state";
import type { CommodityPriceHistory } from "@/lib/db/types/commodityPriceHistory";
import {
  COMMODITIES_NATIONAL_REGIONAL_PRICE_BLEND,
  COMMODITY_PRICE_DRIFT_RATE,
  COMMODITY_TYPES,
  NATIONAL_COMMODITY_STABILIZER,
  blendPrice,
  computeMarketPrice,
  type CommodityType,
} from "@/lib/constants/commodities";
import { costPassThroughMultiplier } from "@/lib/market/costPassThrough";
import { computeGlobalCommodityPrice } from "@/lib/market/globalCommodityPrice";
import { getPriceSoftKnee } from "@/lib/constants/commodities";
import { updateScarcityMultiplier } from "@/lib/market/scarcityDrift";
import { administeredNationalPrice, dualTrackPrice } from "@/lib/economy/administeredPricing";
import { isPlannedEconomy, plannedShare } from "@/lib/constants/commandEconomy";
import { buildReachableBooks } from "@/lib/trade/reachableBook";
import { relativeLaggedPriceRatio } from "@/lib/market/commodityNominalIndex";
import { latentShortageFields, latentShortagePersistence } from "@/lib/turn/latentShortage";
import type { FreightSettlement } from "@/lib/logistics/settlement";
import { NATIONAL_SCOPE_IDS } from "@/lib/constants/nationalScope";
import type { CountryLedger, GlobalLedger, StateLedger } from "./ledgerTypes";

/** Admin-set one-turn global price nudges, keyed by commodity. */
export function buildNudgeMap(
  nudgeDocs: Pick<CommodityPrice, "commodity" | "nudgePrice">[]
): Map<string, number> {
  return new Map<string, number>(
    nudgeDocs
      .filter((d): d is typeof d & { nudgePrice: number } => d.nudgePrice != null)
      .map((d) => [d.commodity, d.nudgePrice])
  );
}

/**
 * Lagged price ratios for producer cost pass-through: PRIOR turn's global
 * price over base — the same one-turn lag the input bill itself is priced
 * with (buildLookups.priceRatioByCommodity), so there is no same-turn
 * circularity between a commodity's price and its producers' costs.
 */
export function buildLaggedRatios(
  ledgerBasePrices: Record<CommodityType, number>,
  existingPriceMap: Map<string, CommodityPrice>,
  laggedNominalIndex: Parameters<typeof relativeLaggedPriceRatio>[2]
): Map<CommodityType, number> {
  const laggedRatios = new Map<CommodityType, number>();
  for (const commodity of COMMODITY_TYPES) {
    const base = ledgerBasePrices[commodity];
    const prior = existingPriceMap.get(commodity)?.globalPrice;
    const ratio = relativeLaggedPriceRatio(prior, base, laggedNominalIndex);
    if (ratio != null) laggedRatios.set(commodity, ratio);
  }
  return laggedRatios;
}

export interface CommodityPricingContext {
  ledgerBasePrices: Record<CommodityType, number>;
  commodityNominalPriceIndex: number;
  scarcityDriftEnabled: boolean;
  commandEconomyEnabled: boolean;
  priceCurrentYear: number | null;
  freightSettlementActive: boolean;
  freightRampFraction: number;
  freightSettlement: FreightSettlement | null;
  existingPriceMap: Map<string, CommodityPrice>;
  nudgeMap: Map<string, number>;
  laggedRatios: Map<CommodityType, number>;
  reachableBooks: ReturnType<typeof buildReachableBooks>;
  global: GlobalLedger;
  byCountry: CountryLedger;
  byState: StateLedger;
  allStates: Pick<State, "_id">[];
  stateToCountry: Map<string, string>;
  demandTruncated: Map<CommodityType, number>;
  /** Mutated: per-commodity world scarcity multiplier, for history rows. */
  scarcityMultByCommodity: Map<CommodityType, number>;
  /** Mutated: actual applied prices, for history rows and trade valuation. */
  appliedGlobalPrices: Map<CommodityType, number>;
  appliedStatePrices: Map<CommodityType, Record<string, number>>;
  appliedNationalPrices: Map<CommodityType, Record<string, number>>;
  turn: number;
  now: Date;
}

export interface PricedCommodity {
  commodity: CommodityType;
  priceOp: {
    updateOne: {
      filter: { commodity: CommodityType };
      update: {
        $set: Omit<CommodityPrice, "commodity">;
        $unset?: Record<string, "">;
      };
      upsert: boolean;
    };
  };
}

/**
 * Full pricing pass for one commodity: global price with drift and
 * peg/nudge precedence, per-country national prices (administered for
 * planned economies), per-country reachable wide legs, and per-state
 * 50/25/25 blended prices with drift. Returns the commodityPrices upsert;
 * records applied prices and scarcity multipliers on the context maps and
 * accumulates states with activity into the caller-owned set.
 */
export function priceCommodity(
  ctx: CommodityPricingContext,
  commodity: CommodityType,
  statesWithActivity: Set<string>
): PricedCommodity {
  const {
    ledgerBasePrices,
    commodityNominalPriceIndex,
    scarcityDriftEnabled,
    commandEconomyEnabled,
    priceCurrentYear,
    freightSettlementActive,
    freightRampFraction,
    freightSettlement,
    existingPriceMap,
    nudgeMap,
    laggedRatios,
    reachableBooks,
    global,
    byCountry,
    byState,
    allStates,
    stateToCountry,
    demandTruncated,
    scarcityMultByCommodity,
    appliedGlobalPrices,
    appliedStatePrices,
    appliedNationalPrices,
    turn,
    now,
  } = ctx;
  const basePrice = ledgerBasePrices[commodity];
  const globalBal = global.get(commodity)!;
  const existing = existingPriceMap.get(commodity);

  // Scarcity drift: advance this commodity's multiplier on the CURRENT
  // aggregate balance, then scale the base price so the global, national
  // and state legs (and the price/base realization ratio) all inherit the
  // scarcity memory consistently. Pegs/nudges still take precedence below.
  const scarcityMult = scarcityDriftEnabled
    ? updateScarcityMultiplier(existing?.scarcityMult, globalBal.supply, globalBal.demand)
    : 1;
  scarcityMultByCommodity.set(commodity, scarcityMult);
  // Per-country scarcity drift on the REACHABLE book (#1077 follow-up).
  // The wide leg already prices the reachable market, but the base it
  // scaled was `basePrice × world scarcityMult` — so a West that is 33%
  // short of food still had its base CRUSHED by the Eastern bloc's
  // unreachable surplus (world integrator 0.71 at t167 while the market
  // bloc ran S/D 0.67). Each country now integrates its own reachable
  // imbalance; the first partitioned turn seeds from the world multiplier
  // so prices drift apart rather than stepping. Stabilizer matches the
  // wide-leg pricing below so the integrator and the level formula read
  // the same book.
  const scarcityMultByCountry: Record<string, number> = {};
  if (scarcityDriftEnabled) {
    for (const countryId of COUNTRY_ORDER) {
      const book = reachableBooks.get(countryId)?.get(commodity);
      if (!book || (book.supply <= 0 && book.demand <= 0)) continue;
      scarcityMultByCountry[countryId] = updateScarcityMultiplier(
        existing?.scarcityMultByCountry?.[countryId] ?? existing?.scarcityMult,
        book.supply + NATIONAL_COMMODITY_STABILIZER,
        book.demand + NATIONAL_COMMODITY_STABILIZER
      );
    }
  }
  // Producer cost pass-through (>= 1, capped): when the inputs to MAKE this
  // commodity trade above base, part of that squeeze lifts the price floor
  // so producers are not structurally forced below cost. See
  // src/lib/market/costPassThrough.ts for the full rationale (the 62%-of-
  // farms-negative incident).
  const costMult = costPassThroughMultiplier(commodity, laggedRatios);
  const nominalBasePrice = basePrice * commodityNominalPriceIndex;
  // Country-scoped effective base: the country's own reachable-scarcity
  // multiplier when it has one, the world base otherwise. Every
  // country-scoped leg (national, wide, regional, administered) reads this
  // so a country's price level carries ITS market's scarcity memory.
  const effBaseFor = (countryId: string | undefined): number => {
    const m = countryId != null ? scarcityMultByCountry[countryId] : undefined;
    return m != null ? Math.round(nominalBasePrice * m * costMult * 100) / 100 : effBasePrice;
  };
  const priceKnee = getPriceSoftKnee(commodity);

  // Global price with drift and peg/nudge precedence, plus an exact
  // explanation of every formula stage.
  const globalResult = computeGlobalCommodityPrice({
    realBasePrice: basePrice,
    nominalIndex: commodityNominalPriceIndex,
    scarcityMultiplier: scarcityMult,
    costPassThroughMultiplier: costMult,
    supply: globalBal.supply,
    demand: globalBal.demand,
    priceKnee,
    previousPrice: existing?.globalPrice,
    hardPeg: existing?.hardPeg ?? undefined,
    nudge: nudgeMap.get(commodity) ?? undefined,
  });
  const globalMktPrice = globalResult.appliedPrice;
  const effBasePrice = globalResult.effectiveBasePrice;
  const priceAttribution = globalResult.attribution;
  appliedGlobalPrices.set(commodity, globalMktPrice);

  // ── National prices per country ───────────────────────────────────────
  // Computed before state prices because the state-leg blend uses the
  // country's national price as one of its three legs.
  const nationalPrices: Record<string, number> = {};
  const nationalSupply: Record<string, number> = {};
  const nationalDemand: Record<string, number> = {};
  for (const [countryId, countryBals] of byCountry) {
    const bal = countryBals.get(commodity)!;
    // NATIONAL_COMMODITY_STABILIZER floors both sides so countries with minimal
    // sector activity don't produce degenerate ratios (same role as STATE_COMMODITY_SUPPLY_DEMAND).
    const marketNationalPrice = computeMarketPrice(
      effBaseFor(countryId),
      bal.supply + NATIONAL_COMMODITY_STABILIZER,
      bal.demand + NATIONAL_COMMODITY_STABILIZER,
      priceKnee
    );
    // Planned economies: the national price is ADMINISTERED (held at the era
    // base + turnover-tax wedge, no S/D response). Dual-track economies blend
    // administered and market by the dial's plannedShare. Fully country-scoped
    // — the market global/regional legs are untouched. Off / market → market.
    if (
      commandEconomyEnabled &&
      isPlannedEconomy(countryId, priceCurrentYear, commandEconomyEnabled)
    ) {
      const administered = administeredNationalPrice(effBaseFor(countryId));
      const share = plannedShare(countryId, priceCurrentYear, commandEconomyEnabled);
      nationalPrices[countryId] = dualTrackPrice(administered, marketNationalPrice, share);
    } else {
      nationalPrices[countryId] = marketNationalPrice;
    }
    nationalSupply[countryId] = Math.round(bal.supply * 100) / 100;
    nationalDemand[countryId] = Math.round(bal.demand * 100) / 100;
  }
  appliedNationalPrices.set(commodity, nationalPrices);

  // Macro-driven commodities have meaningless state-level S/D; the regional
  // leg falls through to national, making the effective blend 50/50.
  const isMacroPriceBlend = COMMODITIES_NATIONAL_REGIONAL_PRICE_BLEND.has(commodity);

  // Per-country reachable wide leg: the price of the market each country can
  // actually reach (see the blend note below). Computed for EVERY country up
  // front — not lazily per state — because it is also PERSISTED as
  // `reachablePrices` for lagged consumers (clearing's price-realization
  // factor). A hard peg or nudge overrides every country to the pegged
  // value, matching the precedence the state/global legs apply.
  const reachablePrices: Record<string, number> = {};
  {
    const pegged = existing?.hardPeg ?? nudgeMap.get(commodity);
    for (const countryId of COUNTRY_ORDER) {
      const book = reachableBooks.get(countryId)?.get(commodity);
      if (!book || (book.supply <= 0 && book.demand <= 0)) continue;
      reachablePrices[countryId] =
        pegged ??
        computeMarketPrice(
          effBaseFor(countryId),
          book.supply + NATIONAL_COMMODITY_STABILIZER,
          book.demand + NATIONAL_COMMODITY_STABILIZER,
          priceKnee
        );
    }
  }

  const statePrices: Record<string, number> = {};
  // Reference captured after loop populates it — stored for history snapshots
  appliedStatePrices.set(commodity, statePrices);
  const stateSupply: Record<string, number> = {};
  const stateDemand: Record<string, number> = {};

  // Write a state price for every state. Even states with no local activity
  // get a composite price so the regional map can always render a full view.
  for (const state of allStates) {
    if (NATIONAL_SCOPE_IDS.has(state._id)) continue;
    const stateId = state._id;
    const stateBal = byState.get(stateId)?.get(commodity) ?? { supply: 0, demand: 0 };
    if (stateBal.supply > 0 || stateBal.demand > 0) {
      statesWithActivity.add(stateId);
    }

    // ── State price with drift + peg/nudge precedence ──
    // Precedence: state peg > state nudge > global peg > global nudge > drift
    let statePrice: number;
    if (existing?.stateHardPegs?.[stateId] != null) {
      statePrice = existing.stateHardPegs[stateId];
    } else if (existing?.stateNudges?.[stateId] != null) {
      statePrice = existing.stateNudges[stateId];
    } else if (existing?.hardPeg != null) {
      statePrice = existing.hardPeg;
    } else if (nudgeMap.has(commodity)) {
      statePrice = nudgeMap.get(commodity)!;
    } else {
      // Three-leg blend: 50% reachable-market + 25% national + 25% regional.
      // For macro-driven commodities the regional leg redirects to national.
      //
      // The wide leg is the price of the market this country can actually
      // REACH — the same reachable book the clearing engine fills sellers
      // from (#1077) — not the planet-wide aggregate. The planet-wide leg
      // priced every open economy against supply that could never arrive:
      // observed on prod, the Eastern bloc's command farms carried a 13.45M
      // food surplus against 2.94M of bloc demand and the single global
      // ledger crushed food to 0.58x base across a West that was itself
      // 2.7M short. Partitioned clearing with unpartitioned pricing meant
      // the iron curtain stopped the goods but not the glut. Countries
      // outside COUNTRY_ORDER (no book) keep the world aggregate.
      const countryId = stateToCountry.get(stateId);
      const nationalLeg =
        countryId && nationalPrices[countryId] != null ? nationalPrices[countryId] : globalMktPrice;
      // Ramp the cap in: blend from full supply (R=0) toward the
      // freight-limited delivered supply (R=1). At R=1 this is the plain
      // capped value; a partial ramp softens the sales cap proportionally.
      const cappedDelivered =
        freightSettlement?.deliveredSupplyByCommodity.get(commodity)?.get(stateId) ??
        stateBal.supply;
      const deliveredSupply = freightSettlementActive
        ? stateBal.supply + freightRampFraction * (cappedDelivered - stateBal.supply)
        : stateBal.supply;
      const regionalLeg = isMacroPriceBlend
        ? nationalLeg
        : computeMarketPrice(effBaseFor(countryId), deliveredSupply, stateBal.demand, priceKnee);
      const wideLeg =
        (countryId != null ? reachablePrices[countryId] : undefined) ?? globalMktPrice;
      let targetPrice = blendPrice(wideLeg, nationalLeg, regionalLeg);
      // Autarky (P3, owner decision 2026-08-16): in a planned economy the
      // PLAN sets prices, not the market — for the whole state price, not
      // just the national leg. With the iron curtain closed the bloc's
      // internal surpluses would otherwise crater its market legs and
      // starve every state farm of revenue the plan is supposed to
      // guarantee; administered pricing is what makes the bloc function in
      // autarky (the state eats the imbalance, historically exactly right,
      // and the overhang machinery accounts it). Dual-track economies blend
      // by plannedShare; market economies are untouched.
      if (
        countryId &&
        commandEconomyEnabled &&
        isPlannedEconomy(countryId, priceCurrentYear, commandEconomyEnabled)
      ) {
        targetPrice = dualTrackPrice(
          administeredNationalPrice(effBaseFor(countryId)),
          targetPrice,
          plannedShare(countryId, priceCurrentYear, commandEconomyEnabled)
        );
      }
      const previousPrice = existing?.statePrices?.[stateId] ?? targetPrice;
      statePrice =
        Math.round(
          (previousPrice + COMMODITY_PRICE_DRIFT_RATE * (targetPrice - previousPrice)) * 100
        ) / 100;
    }

    statePrices[stateId] = statePrice;
    stateSupply[stateId] = Math.round(stateBal.supply * 100) / 100;
    stateDemand[stateId] = Math.round(stateBal.demand * 100) / 100;
  }

  const deliveredSupply = freightSettlementActive
    ? Object.fromEntries(
        freightSettlement?.deliveredSupplyByCommodity.get(commodity)?.entries() ?? []
      )
    : undefined;
  const inputAvailability = freightSettlementActive
    ? Object.fromEntries(
        freightSettlement?.inputAvailabilityByCommodity.get(commodity)?.entries() ?? []
      )
    : undefined;
  // Sell side of the same settlement: how much of each state's OWN output
  // found a buyer. Persisted next to the buy-side pair above so next turn's
  // corporation phase can offer only what a network could actually move.
  // Without it, clearing (country-scoped) and freight (state-scoped) keep
  // contradicting each other, which at t225 left 60.4% of world production
  // stranded in a state that did not need it.
  const placedSupply = freightSettlementActive
    ? Object.fromEntries(freightSettlement?.placedSupplyByCommodity.get(commodity)?.entries() ?? [])
    : undefined;
  // Why this is persisted separately and not derived as supply minus placed:
  // the difference lumps a glut in with a delivery failure, and the player
  // copy built on it says opposite things in the two cases.
  const deliveryLimitedSupply = freightSettlementActive
    ? Object.fromEntries(
        freightSettlement?.deliveryLimitedSupplyByCommodity.get(commodity)?.entries() ?? []
      )
    : undefined;

  const latentShortage = latentShortagePersistence(globalBal, demandTruncated.get(commodity));

  return {
    commodity,
    priceOp: {
      updateOne: {
        filter: { commodity },
        update: {
          $set: {
            basePrice,
            globalPrice: globalMktPrice,
            globalSupply: Math.round(globalBal.supply * 100) / 100,
            globalDemand: Math.round(globalBal.demand * 100) / 100,
            ...latentShortage.set,
            statePrices,
            stateSupply,
            stateDemand,
            ...(deliveredSupply ? { stateDeliveredSupply: deliveredSupply } : {}),
            ...(inputAvailability ? { stateInputAvailability: inputAvailability } : {}),
            ...(placedSupply ? { statePlacedSupply: placedSupply } : {}),
            ...(deliveryLimitedSupply ? { stateDeliveryLimitedSupply: deliveryLimitedSupply } : {}),
            nationalPrices,
            nationalSupply,
            nationalDemand,
            turn,
            // Clear consumed nudges — pegs are preserved (not included in $set)
            nudgePrice: null,
            nudgeTurn: null,
            stateNudges: {},
            scarcityMult,
            scarcityMultByCountry,
            reachablePrices,
            priceAttribution,
            updatedAt: now,
          },
          ...(Object.keys(latentShortage.unset).length > 0 ? { $unset: latentShortage.unset } : {}),
        },
        upsert: true,
      },
    },
  };
}

export interface PriceHistoryInputs {
  global: GlobalLedger;
  demandTruncated: Map<CommodityType, number>;
  appliedGlobalPrices: Map<CommodityType, number>;
  appliedStatePrices: Map<CommodityType, Record<string, number>>;
  appliedNationalPrices: Map<CommodityType, Record<string, number>>;
  scarcityMultByCommodity: Map<CommodityType, number>;
  ledgerBasePrices: Record<CommodityType, number>;
  commodityNominalPriceIndex: number;
  turn: number;
  now: Date;
}

/**
 * Price history snapshots for charting — uses the actual applied price
 * (including drift, pegs, and nudges) so charts match what players see.
 */
export function buildPriceHistoryDocs(
  inputs: PriceHistoryInputs
): (Omit<CommodityPriceHistory, "commodity"> & { commodity: CommodityType })[] {
  const {
    global,
    demandTruncated,
    appliedGlobalPrices,
    appliedStatePrices,
    appliedNationalPrices,
    scarcityMultByCommodity,
    ledgerBasePrices,
    commodityNominalPriceIndex,
    turn,
    now,
  } = inputs;
  return COMMODITY_TYPES.map((commodity) => {
    const globalBal = global.get(commodity)!;
    return {
      commodity,
      turn,
      globalPrice:
        appliedGlobalPrices.get(commodity) ??
        computeMarketPrice(
          ledgerBasePrices[commodity] * commodityNominalPriceIndex,
          globalBal.supply,
          globalBal.demand
        ),
      globalSupply: Math.round(globalBal.supply * 100) / 100,
      globalDemand: Math.round(globalBal.demand * 100) / 100,
      ...latentShortageFields(globalBal, demandTruncated.get(commodity)),
      statePrices: appliedStatePrices.get(commodity) ?? {},
      nationalPrices: appliedNationalPrices.get(commodity) ?? {},
      scarcityMult: scarcityMultByCommodity.get(commodity) ?? 1,
      createdAt: now,
    };
  });
}
