/**
 * NPP supply-agreement matching (supplyAgreementsEnabled).
 *
 * Player CEOs propose and accept bilateral contracts. NPP CEOs never did, so
 * under a 1953 all-flags plants world the contract book stayed empty while
 * every plant sat input-starved (sandbox soak: throughputFactor 0.85 on all
 * 675 sectors) and extractors sat in shortage. This pass is the missing
 * operator: NPP buyers accept honest inbound proposals, NPP suppliers lock
 * same-country NPP buyers, and a mothballed supplier serves cancel notice
 * before shortfall damages land on a cold plant.
 *
 * Same-country only. 1953 has CoCom/Comecon embargo lanes; crossing them
 * here would ignore the trade graph the clearing book already respects.
 * Player counterparties are never proposed to (inbox spam); a player who
 * proposes TO an NPP buyer still gets an auto-accept when the terms are
 * honest.
 */

import { substepMarker } from "@/lib/observability/phaseSubsteps";
import type { Db } from "mongodb";
import { ObjectId } from "mongodb";
import type { Corporation, CorporateSector, GameConfig, GameState } from "@/lib/db/types";
import type { TradeEmbargo } from "@/lib/db/types/tradeEmbargo";
import type { SupplyListing } from "@/lib/db/types/supplyListing";
import { isCurtained, isPlannedEconomy } from "@/lib/constants/commandEconomy";
import type { CommodityType } from "@/lib/constants/commodities";
import { SECTOR_DEMAND, SECTOR_SUPPLY } from "@/lib/constants/commodities";
import type { CorporationType, MediaDiscriminator } from "@/lib/constants/corporations";
import {
  CONTRACT_CANCEL_NOTICE_TURNS,
  CONTRACT_OVERCOMMIT_TOLERANCE,
  SUPPLY_AGREEMENT_PRICE_BAND,
  type SupplyAgreement,
} from "@/lib/db/types/supplyAgreement";
import { computeSupplierCommodityCapacityUnits } from "@/lib/corporations/supplyAgreementCapacity";
import { glutStaggerEligible } from "@/lib/turn/npp/cohort";
import { isStateOwned } from "@/lib/nationalization/nationalCorporation";
import {
  getEffectiveStrategyRatesForOperatingModel,
  getOperatingSectorType,
} from "@/lib/constants/sectorStrategies";
import {
  supplyAgreementRequiresState,
  supportsCorporationWideSupplyAgreement,
} from "@/lib/market/commodityMarketScope";
import { supplyAgreementSectorsInScope } from "@/lib/corporations/supplyAgreementCapacity";

/** Fill below this: the seller cannot move output and will discount to lock a buyer. */
export const NPP_CONTRACT_GLUT_FILL = 0.5;
/** Throughput below this: the buyer is input-starved and will take a contract. */
export const NPP_CONTRACT_STARVE_THROUGHPUT = 0.95;
/** Input price ratio at or above this also marks the buyer as starved. */
export const NPP_CONTRACT_INPUT_SHORTAGE = 1.1;
/** Refuse inbound premiums above this (a 20% gouge is not "honest"). */
export const NPP_CONTRACT_MAX_ACCEPT_PREMIUM = 0.2;
/** Discount a glutted seller offers. */
export const NPP_CONTRACT_GLUT_PREMIUM = -0.1;
/** Premium a shortage seller charges. */
export const NPP_CONTRACT_SHORTAGE_PREMIUM = 0.1;
/** Share of uncommitted capacity one new contract may take. */
export const NPP_CONTRACT_CAPACITY_SHARE = 0.25;

export type NppAgreementParty = {
  corpId: string;
  countryId: string;
  isNatcorp: boolean;
  /** Character/imperial CEO. NPP matching must never bind these as counterparties. */
  isPlayer?: boolean;
  sectors: Array<{
    sectorType: CorporationType;
    industryModel?: string | null;
    mediaDiscriminator?: MediaDiscriminator | null;
    capitalStock?: number | null;
    producedUnits?: number | null;
    soldFraction?: number | null;
    throughputFactor?: number | null;
    mothballed?: boolean | null;
    strategyId?: string | null;
    transitionFromStrategyId?: string | null;
    retoolRescaleApplied?: boolean;
    transitionStartTurn?: number | null;
    productionPolicyLevel?: number | null;
    embargoSuspended?: boolean | null;
    embargoExportExposure?: number | null;
    countryId?: string | null;
    /** Host state, so freight (state-scoped) can be matched within one state. */
    stateId?: string | null;
  }>;
};

export type ExistingNppAgreement = {
  id: string;
  supplierCorpId: string;
  buyerCorpId: string;
  commodity: CommodityType;
  /** Present on a state-scoped agreement; absent on corporation-wide ones. */
  stateId?: string;
  volumeCap: number;
  pricePremium: number;
  status: SupplyAgreement["status"];
  /** Corporation that authored the standing offer (a buyer-authored pending proposal). */
  proposedByCorpId?: string;
  durationTurns?: number;
};

/** A non-NPP counterparty whose inbound proposals an NPP supplier may accept. */
export type ExternalBuyer = { countryId: string };

export type NppAgreementDecision =
  | { action: "activate"; agreementId: string }
  | { action: "cancelNotice"; agreementId: string }
  | {
      action: "propose";
      supplierCorpId: string;
      buyerCorpId: string;
      commodity: CommodityType;
      /** Set when the commodity is state-scoped: the state the contract is fulfilled from. */
      stateId?: string;
      volumeCap: number;
      pricePremium: number;
    };

/**
 * A corporation-wide agreement for a state-scoped commodity is a legacy
 * contract with no state identity; the NPP matcher leaves those to the
 * migration and neither activates nor extends them.
 */
function agreementHasScope(a: Pick<ExistingNppAgreement, "commodity" | "stateId">): boolean {
  return supportsCorporationWideSupplyAgreement(a.commodity) || !!a.stateId;
}

function liveStatuses(status: SupplyAgreement["status"]): boolean {
  return status === "pending" || status === "active" || status === "cancelling";
}

function commoditiesOf(
  sectorType: CorporationType,
  side: "supply" | "demand",
  strategyId: string | null | undefined,
  transitionFrom: string | null | undefined,
  transitionStart: number | null | undefined,
  turn: number,
  industryModel?: string | null,
  mediaDiscriminator?: MediaDiscriminator | null
): CommodityType[] {
  const rates = getEffectiveStrategyRatesForOperatingModel(
    sectorType,
    strategyId ?? "standard",
    transitionFrom,
    transitionStart,
    turn,
    industryModel,
    mediaDiscriminator
  );
  const mix = side === "supply" ? rates.supply : rates.demand;
  const fromStrategy = (Object.keys(mix) as CommodityType[]).filter((c) => (mix[c] ?? 0) > 0);
  if (fromStrategy.length > 0) return fromStrategy;
  const operatingType = getOperatingSectorType(
    sectorType,
    industryModel,
    mediaDiscriminator
  ) as CorporationType;
  const table = side === "supply" ? SECTOR_SUPPLY[operatingType] : SECTOR_DEMAND[operatingType];
  return (table ?? []).filter((f) => f.rate > 0).map((f) => f.commodity);
}

function sellerFill(
  party: NppAgreementParty,
  commodity: CommodityType,
  turn: number
): number | null {
  let sold = 0;
  let n = 0;
  for (const s of party.sectors) {
    if (s.mothballed === true) continue;
    const outputs = commoditiesOf(
      s.sectorType,
      "supply",
      s.strategyId,
      s.transitionFromStrategyId,
      s.transitionStartTurn,
      turn,
      s.industryModel,
      s.mediaDiscriminator
    );
    if (!outputs.includes(commodity)) continue;
    if (typeof s.soldFraction === "number" && Number.isFinite(s.soldFraction)) {
      sold += s.soldFraction;
      n += 1;
    }
  }
  return n > 0 ? sold / n : null;
}

function buyerStarved(
  party: NppAgreementParty,
  commodity: CommodityType,
  turn: number,
  priceRatio: number | null,
  /** State-scoped commodity: only the buyer's plants in this state count. */
  stateId?: string
): boolean {
  let uses = false;
  let worstThroughput = 1;
  for (const s of supplyAgreementSectorsInScope(party.sectors, stateId)) {
    if (s.mothballed === true) continue;
    const inputs = commoditiesOf(
      s.sectorType,
      "demand",
      s.strategyId,
      s.transitionFromStrategyId,
      s.transitionStartTurn,
      turn,
      s.industryModel,
      s.mediaDiscriminator
    );
    if (!inputs.includes(commodity)) continue;
    uses = true;
    if (typeof s.throughputFactor === "number" && Number.isFinite(s.throughputFactor)) {
      worstThroughput = Math.min(worstThroughput, s.throughputFactor);
    }
  }
  if (!uses) return false;
  if (worstThroughput < NPP_CONTRACT_STARVE_THROUGHPUT) return true;
  return priceRatio != null && priceRatio >= NPP_CONTRACT_INPUT_SHORTAGE;
}

/** Distinguishes an absent state from any real state id in index keys. */
const NO_STATE = "\u0000";

/**
 * `committedVolume` and `pairExists` answered from one pass over the live
 * agreements. The proposal step asks them for every supplier output and every
 * candidate buyer; scanning all ~26,000 agreements per question made the
 * matcher the costliest CPU step of the corporation turn. Sums accumulate in
 * the agreements' own order, so totals match the scanning versions exactly.
 */
export function indexLiveAgreements(agreements: readonly ExistingNppAgreement[]) {
  const committed = new Map<string, number>();
  const pairs = new Set<string>();
  for (const a of agreements) {
    if (!liveStatuses(a.status)) continue;
    const state = a.stateId ?? NO_STATE;
    const volumeKey = `${a.supplierCorpId}|${a.commodity}|${state}`;
    committed.set(volumeKey, (committed.get(volumeKey) ?? 0) + a.volumeCap);
    pairs.add(`${a.supplierCorpId}|${a.buyerCorpId}|${a.commodity}|${state}`);
  }
  return {
    committedVolume: (supplierCorpId: string, commodity: CommodityType, stateId?: string) =>
      committed.get(`${supplierCorpId}|${commodity}|${stateId ?? NO_STATE}`) ?? 0,
    pairExists: (
      supplierCorpId: string,
      buyerCorpId: string,
      commodity: CommodityType,
      stateId?: string
    ) => pairs.has(`${supplierCorpId}|${buyerCorpId}|${commodity}|${stateId ?? NO_STATE}`),
  };
}

export function nppContractPremium(fill: number | null, priceRatio: number | null): number {
  if (fill != null && fill < NPP_CONTRACT_GLUT_FILL) return NPP_CONTRACT_GLUT_PREMIUM;
  if (priceRatio != null && priceRatio >= NPP_CONTRACT_INPUT_SHORTAGE) {
    return NPP_CONTRACT_SHORTAGE_PREMIUM;
  }
  return 0;
}

/**
 * Pure matcher. `staggerEligible` is the same hash the mothball pass uses so
 * a young world of single-sector NPP corps does not all contract on one turn.
 */
export function decideNppSupplyAgreements(args: {
  /** `gameState.currentYear`, with the flag below, resolves planned economies. */
  currentYear?: number | null;
  /** `gameConfig.commandEconomyEnabled`. */
  commandEconomyEnabled?: boolean | null;
  turn: number;
  plantsEnabled: boolean;
  parties: readonly NppAgreementParty[];
  agreements: readonly ExistingNppAgreement[];
  priceRatioOf: (commodity: CommodityType, countryId: string) => number | null;
  staggerEligible: (corpId: string) => boolean;
  /** Player buyers by corp id, for supplier-side accepts of their proposals. */
  externalBuyers?: ReadonlyMap<string, ExternalBuyer>;
  /** True when trade between the two countries is walled off for this commodity. */
  tradeBlocked?: (
    commodity: CommodityType,
    supplierCountry: string,
    buyerCountry: string
  ) => boolean;
}): NppAgreementDecision[] {
  const { turn, plantsEnabled, parties, agreements, priceRatioOf, staggerEligible } = args;
  // Threaded into every capacity check so the head-room the matcher proposes
  // sits on the same base the production sink credits (see
  // `computeSupplierCommodityCapacityUnits`).
  const economy = {
    currentYear: args.currentYear,
    commandEconomyEnabled: args.commandEconomyEnabled,
  };
  const byId = new Map(parties.map((p) => [p.corpId, p]));
  const out: NppAgreementDecision[] = [];
  // Contracted volume for the supplier-side accept test: settled contracts
  // only, so one pending proposal does not count against another.
  const liveBeforeAccepts = args.externalBuyers
    ? indexLiveAgreements(agreements.filter((a) => a.status !== "pending"))
    : null;
  const acceptedBuyer = new Set<string>();
  const proposedSupplier = new Set<string>();
  const proposedBuyer = new Set<string>();

  // 1. Auto-accept inbound pending proposals the NPP buyer actually needs.
  for (const a of agreements) {
    if (a.status !== "pending") continue;
    if (!agreementHasScope(a)) continue;
    const buyer = byId.get(a.buyerCorpId);
    if (!buyer || buyer.isNatcorp) continue;
    if (!staggerEligible(buyer.corpId)) continue;
    if (acceptedBuyer.has(buyer.corpId)) continue;
    if (a.pricePremium > NPP_CONTRACT_MAX_ACCEPT_PREMIUM) continue;
    if (a.pricePremium < -SUPPLY_AGREEMENT_PRICE_BAND) continue;
    // A state contract is only useful to plants in that state.
    const uses = supplyAgreementSectorsInScope(buyer.sectors, a.stateId).some((s) => {
      if (s.mothballed === true) return false;
      return commoditiesOf(
        s.sectorType,
        "demand",
        s.strategyId,
        s.transitionFromStrategyId,
        s.transitionStartTurn,
        turn,
        s.industryModel,
        s.mediaDiscriminator
      ).includes(a.commodity);
    });
    if (!uses) continue;
    out.push({ action: "activate", agreementId: a.id });
    acceptedBuyer.add(buyer.corpId);
  }

  // 1b. An AI supplier accepts a player buyer's pending proposal when it has
  // spare capacity, the discount is no deeper than the glut discount, and no
  // embargo or curtain lies between the two countries.
  if (plantsEnabled && args.externalBuyers) {
    const accepted = new Map<string, number>();
    for (const a of agreements) {
      if (a.status !== "pending") continue;
      if (!agreementHasScope(a)) continue;
      const buyer = args.externalBuyers.get(a.buyerCorpId);
      if (!buyer || a.proposedByCorpId !== a.buyerCorpId) continue;
      const supplier = byId.get(a.supplierCorpId);
      if (!supplier || supplier.isNatcorp || supplier.isPlayer) continue;
      if (a.pricePremium < NPP_CONTRACT_GLUT_PREMIUM) continue;
      if (a.pricePremium > SUPPLY_AGREEMENT_PRICE_BAND) continue;
      if (
        buyer.countryId !== supplier.countryId &&
        args.tradeBlocked?.(a.commodity, supplier.countryId, buyer.countryId)
      ) {
        continue;
      }
      const capacity = computeSupplierCommodityCapacityUnits({
        sectors: supplier.sectors,
        commodity: a.commodity,
        isNatcorp: supplier.isNatcorp,
        turn,
        ...economy,
        stateId: a.stateId,
      });
      const key = `${supplier.corpId}|${a.commodity}|${a.stateId ?? NO_STATE}`;
      const taken = accepted.get(key) ?? 0;
      const spare =
        capacity * CONTRACT_OVERCOMMIT_TOLERANCE -
        liveBeforeAccepts!.committedVolume(supplier.corpId, a.commodity, a.stateId) -
        taken;
      if (!(a.volumeCap > 0) || a.volumeCap > spare) continue;
      out.push({ action: "activate", agreementId: a.id });
      accepted.set(key, taken + a.volumeCap);
    }
  }

  // 2. Serve cancel notice when the supplier has gone cold on that commodity.
  for (const a of agreements) {
    if (a.status !== "active") continue;
    if (!agreementHasScope(a)) continue;
    const supplier = byId.get(a.supplierCorpId);
    if (!supplier) continue;
    if (!staggerEligible(supplier.corpId)) continue;
    const capacity = plantsEnabled
      ? computeSupplierCommodityCapacityUnits({
          sectors: supplier.sectors,
          commodity: a.commodity,
          isNatcorp: supplier.isNatcorp,
          turn,
          ...economy,
          stateId: a.stateId,
        })
      : supplyAgreementSectorsInScope(supplier.sectors, a.stateId).some(
            (s) =>
              s.mothballed !== true &&
              commoditiesOf(
                s.sectorType,
                "supply",
                s.strategyId,
                s.transitionFromStrategyId,
                s.transitionStartTurn,
                turn,
                s.industryModel,
                s.mediaDiscriminator
              ).includes(a.commodity)
          )
        ? 1
        : 0;
    if (capacity > 0) continue;
    out.push({ action: "cancelNotice", agreementId: a.id });
  }

  if (!plantsEnabled) return out;
  const live = indexLiveAgreements(agreements);

  // 3. Propose NPP-NPP same-country contracts into starved buyers.
  for (const supplier of parties) {
    if (supplier.isNatcorp) continue;
    if (supplier.isPlayer) continue;
    if (!staggerEligible(supplier.corpId)) continue;
    if (proposedSupplier.has(supplier.corpId)) continue;

    type Candidate = {
      buyer: NppAgreementParty;
      commodity: CommodityType;
      stateId?: string;
      volumeCap: number;
      pricePremium: number;
      score: number;
    };
    let best: Candidate | null = null;

    // What the supplier can contract: each reachable output commodity once,
    // and each state-scoped output (freight) once PER host state, since a
    // freight contract is fulfilled from one state's plants.
    const outputScopes = new Map<string, { commodity: CommodityType; stateId?: string }>();
    for (const s of supplier.sectors) {
      if (s.mothballed === true) continue;
      for (const c of commoditiesOf(
        s.sectorType,
        "supply",
        s.strategyId,
        s.transitionFromStrategyId,
        s.transitionStartTurn,
        turn,
        s.industryModel,
        s.mediaDiscriminator
      )) {
        if (supplyAgreementRequiresState(c)) {
          if (!s.stateId) continue;
          outputScopes.set(`${c}@${s.stateId}`, { commodity: c, stateId: s.stateId });
        } else {
          outputScopes.set(c, { commodity: c });
        }
      }
    }

    for (const { commodity, stateId } of outputScopes.values()) {
      const capacity = computeSupplierCommodityCapacityUnits({
        sectors: supplier.sectors,
        commodity,
        isNatcorp: supplier.isNatcorp,
        turn,
        ...economy,
        stateId,
      });
      const uncommitted = Math.max(
        0,
        capacity * CONTRACT_OVERCOMMIT_TOLERANCE -
          live.committedVolume(supplier.corpId, commodity, stateId)
      );
      const volumeCap = uncommitted * NPP_CONTRACT_CAPACITY_SHARE;
      if (!(volumeCap > 0)) continue;

      const fill = sellerFill(supplier, commodity, turn);
      const priceRatio = priceRatioOf(commodity, supplier.countryId);
      const premium = nppContractPremium(fill, priceRatio);

      for (const buyer of parties) {
        if (buyer.corpId === supplier.corpId) continue;
        if (buyer.isNatcorp) continue;
        if (buyer.isPlayer) continue;
        if (buyer.countryId !== supplier.countryId) continue;
        if (proposedBuyer.has(buyer.corpId) || acceptedBuyer.has(buyer.corpId)) continue;
        if (live.pairExists(supplier.corpId, buyer.corpId, commodity, stateId)) continue;
        const buyerRatio = priceRatioOf(commodity, buyer.countryId);
        if (!buyerStarved(buyer, commodity, turn, buyerRatio, stateId)) continue;
        const score = (fill == null ? 0.5 : 1 - fill) + Math.max(0, (buyerRatio ?? 1) - 1);
        if (!best || score > best.score) {
          best = { buyer, commodity, stateId, volumeCap, pricePremium: premium, score };
        }
      }
    }

    if (!best) continue;
    out.push({
      action: "propose",
      supplierCorpId: supplier.corpId,
      buyerCorpId: best.buyer.corpId,
      commodity: best.commodity,
      ...(best.stateId ? { stateId: best.stateId } : {}),
      volumeCap: best.volumeCap,
      pricePremium: best.pricePremium,
    });
    proposedSupplier.add(supplier.corpId);
    proposedBuyer.add(best.buyer.corpId);
  }

  return out;
}

/** Sell and buy listings one AI corporation may keep up; well inside the ten-slot cap. */
export const AI_LISTINGS_PER_SIDE = 3;
/** Share of spare capacity one standing sell listing advertises. */
export const AI_LISTING_CAPACITY_FRACTION = 0.5;
/** Turns an AI listing stays on the board before it must be refreshed. */
export const AI_LISTING_TTL_TURNS = 24;
const AI_LISTING_MIN_PREMIUM = NPP_CONTRACT_GLUT_PREMIUM;
const AI_LISTING_MAX_PREMIUM = NPP_CONTRACT_MAX_ACCEPT_PREMIUM;

export type AiListingSpec = {
  corpId: string;
  side: "buy" | "sell";
  commodity: CommodityType;
  stateId?: string;
  volumeCap: number;
  pricePremium: number;
};

/** Stable key an AI listing upserts on: (corporation, side, commodity[, state]). */
export function aiListingId(
  spec: Pick<AiListingSpec, "corpId" | "side" | "commodity" | "stateId">
): string {
  return `${spec.corpId}:ai:${spec.side}:${spec.commodity}${spec.stateId ? `:${spec.stateId}` : ""}`;
}

function listingPremium(priceRatio: number | null): number {
  if (priceRatio == null) return 0;
  const raw = Math.round((priceRatio - 1) * 1000) / 1000;
  return Math.min(AI_LISTING_MAX_PREMIUM, Math.max(AI_LISTING_MIN_PREMIUM, raw));
}

/**
 * Pure: the standing listings AI market-economy corporations want on the board.
 * Sell listings come from spare capacity net of contracted volume; buy
 * listings from input demand the corp cannot cover (starved plants or a
 * shortage price). Planned economies and player corps never list.
 */
export function decideAiSupplyListings(args: {
  currentYear?: number | null;
  commandEconomyEnabled?: boolean | null;
  turn: number;
  plantsEnabled: boolean;
  parties: readonly NppAgreementParty[];
  agreements: readonly ExistingNppAgreement[];
  priceRatioOf: (commodity: CommodityType, countryId: string) => number | null;
}): AiListingSpec[] {
  const { turn, parties, priceRatioOf } = args;
  if (!args.plantsEnabled) return [];
  const economy = {
    currentYear: args.currentYear,
    commandEconomyEnabled: args.commandEconomyEnabled,
  };
  const live = indexLiveAgreements(args.agreements);
  const out: AiListingSpec[] = [];
  for (const party of parties) {
    if (party.isPlayer) continue;
    if (isPlannedEconomy(party.countryId, args.currentYear, args.commandEconomyEnabled)) continue;

    const sells: AiListingSpec[] = [];
    const buys: AiListingSpec[] = [];
    const seenSell = new Set<string>();
    const seenBuy = new Set<string>();
    for (const s of party.sectors) {
      if (s.mothballed === true) continue;
      for (const c of commoditiesOf(
        s.sectorType,
        "supply",
        s.strategyId,
        s.transitionFromStrategyId,
        s.transitionStartTurn,
        turn,
        s.industryModel,
        s.mediaDiscriminator
      )) {
        const stateId = supplyAgreementRequiresState(c) ? (s.stateId ?? undefined) : undefined;
        if (supplyAgreementRequiresState(c) && !stateId) continue;
        const key = `${c}|${stateId ?? NO_STATE}`;
        if (seenSell.has(key)) continue;
        seenSell.add(key);
        const capacity = computeSupplierCommodityCapacityUnits({
          sectors: party.sectors,
          commodity: c,
          isNatcorp: party.isNatcorp,
          turn,
          ...economy,
          stateId,
        });
        const spare = Math.max(
          0,
          capacity * CONTRACT_OVERCOMMIT_TOLERANCE - live.committedVolume(party.corpId, c, stateId)
        );
        const volumeCap = spare * AI_LISTING_CAPACITY_FRACTION;
        if (!(volumeCap > 0)) continue;
        sells.push({
          corpId: party.corpId,
          side: "sell",
          commodity: c,
          ...(stateId ? { stateId } : {}),
          volumeCap,
          pricePremium: listingPremium(priceRatioOf(c, party.countryId)),
        });
      }
      for (const c of commoditiesOf(
        s.sectorType,
        "demand",
        s.strategyId,
        s.transitionFromStrategyId,
        s.transitionStartTurn,
        turn,
        s.industryModel,
        s.mediaDiscriminator
      )) {
        const stateId = supplyAgreementRequiresState(c) ? (s.stateId ?? undefined) : undefined;
        if (supplyAgreementRequiresState(c) && !stateId) continue;
        const key = `${c}|${stateId ?? NO_STATE}`;
        if (seenBuy.has(key)) continue;
        seenBuy.add(key);
        const ratio = priceRatioOf(c, party.countryId);
        if (!buyerStarved(party, c, turn, ratio, stateId)) continue;
        // Unmet demand proxy: output the starved plants in scope fail to make.
        let unmet = 0;
        for (const t of supplyAgreementSectorsInScope(party.sectors, stateId)) {
          if (t.mothballed === true) continue;
          const th = typeof t.throughputFactor === "number" ? t.throughputFactor : 1;
          unmet += Math.max(0, 1 - th) * Math.max(0, t.producedUnits ?? 0);
        }
        buys.push({
          corpId: party.corpId,
          side: "buy",
          commodity: c,
          ...(stateId ? { stateId } : {}),
          volumeCap: Math.max(1, unmet),
          pricePremium: listingPremium(ratio),
        });
      }
    }
    sells.sort((a, b) => b.volumeCap - a.volumeCap);
    buys.sort((a, b) => b.volumeCap - a.volumeCap);
    out.push(...sells.slice(0, AI_LISTINGS_PER_SIDE), ...buys.slice(0, AI_LISTINGS_PER_SIDE));
  }
  return out;
}

/** Walls between two countries for a commodity: live blocking embargoes or the iron curtain. */
export function buildTradeBlocked(args: {
  embargoes: readonly Pick<
    TradeEmbargo,
    "sourceCountry" | "targetCountry" | "commodity" | "direction" | "mode" | "expiresTurn"
  >[];
  turn: number;
  currentYear?: number | null;
  commandEconomyEnabled?: boolean | null;
}): (commodity: CommodityType, supplierCountry: string, buyerCountry: string) => boolean {
  const active = args.embargoes.filter(
    (e) => e.mode === "block" && (e.expiresTurn == null || e.expiresTurn >= args.turn)
  );
  return (commodity, supplierCountry, buyerCountry) => {
    if (supplierCountry === buyerCountry) return false;
    if (
      isCurtained(supplierCountry, args.currentYear, args.commandEconomyEnabled) !==
      isCurtained(buyerCountry, args.currentYear, args.commandEconomyEnabled)
    ) {
      return true;
    }
    return active.some((e) => {
      if (e.commodity !== "all" && e.commodity !== commodity) return false;
      const direction = e.direction ?? "export";
      if (e.sourceCountry === supplierCountry && e.targetCountry === buyerCountry) {
        return direction === "export" || direction === "both";
      }
      if (e.sourceCountry === buyerCountry && e.targetCountry === supplierCountry) {
        return direction === "import" || direction === "both";
      }
      return false;
    });
  };
}

/**
 * Only what `toParty` and the agreement map below read. The pass loads every
 * NPP sector and every live NPP agreement each turn; full documents were about
 * 23 MB a turn on the live world, these fields about 5 MB.
 */
export const NPP_SUPPLY_SECTOR_PROJECTION = {
  corporationId: 1,
  sectorType: 1,
  capitalStock: 1,
  producedUnits: 1,
  soldFraction: 1,
  throughputFactor: 1,
  mothballed: 1,
  strategyId: 1,
  transitionFromStrategyId: 1,
  retoolRescaleApplied: 1,
  transitionStartTurn: 1,
  productionPolicyLevel: 1,
  embargoSuspended: 1,
  embargoExportExposure: 1,
  countryId: 1,
  stateId: 1,
} as const;

export const NPP_SUPPLY_AGREEMENT_PROJECTION = {
  supplierCorpId: 1,
  buyerCorpId: 1,
  commodity: 1,
  stateId: 1,
  volumeCap: 1,
  pricePremium: 1,
  status: 1,
  proposedByCorpId: 1,
  durationTurns: 1,
} as const;

export function toExistingNppAgreement(a: SupplyAgreement): ExistingNppAgreement {
  return {
    id: a._id!.toString(),
    supplierCorpId: a.supplierCorpId.toString(),
    buyerCorpId: a.buyerCorpId.toString(),
    commodity: a.commodity,
    ...(a.stateId ? { stateId: a.stateId } : {}),
    volumeCap: a.volumeCap,
    pricePremium: a.pricePremium,
    status: a.status,
    ...(a.proposedByCorpId ? { proposedByCorpId: a.proposedByCorpId.toString() } : {}),
    ...(a.durationTurns != null ? { durationTurns: a.durationTurns } : {}),
  };
}

export function toParty(corp: Corporation, sectors: CorporateSector[]): NppAgreementParty {
  return {
    corpId: corp._id.toString(),
    countryId: corp.countryId,
    isNatcorp: isStateOwned(corp),
    isPlayer: corp.ceoType != null && corp.ceoType !== "npp",
    sectors: sectors.map((s) => ({
      sectorType: s.sectorType,
      industryModel: s.industryModel,
      mediaDiscriminator: s.mediaDiscriminator,
      capitalStock: s.capitalStock,
      producedUnits: s.producedUnits,
      soldFraction: s.soldFraction,
      throughputFactor: s.throughputFactor,
      mothballed: s.mothballed,
      strategyId: s.strategyId,
      transitionFromStrategyId: s.transitionFromStrategyId,
      retoolRescaleApplied: s.retoolRescaleApplied,
      transitionStartTurn: s.transitionStartTurn,
      productionPolicyLevel: s.productionPolicyLevel,
      embargoSuspended: s.embargoSuspended,
      embargoExportExposure: s.embargoExportExposure,
      countryId: s.countryId,
      stateId: s.stateId,
    })),
  };
}

/**
 * Refresh the AI corporations' standing listings: upsert what the rules want
 * (only when terms moved or the listing nears expiry), delete the rest. Three
 * batched calls regardless of corporation count.
 */
export async function syncAiSupplyListings(
  db: Db,
  args: Parameters<typeof decideAiSupplyListings>[0] & { now: Date }
): Promise<{ upserted: number; removed: number }> {
  const { turn, now } = args;
  const desired = decideAiSupplyListings(args);
  const collection = db.collection<SupplyListing>("supplyListings");
  const corpObjectIds = args.parties.map((p) => new ObjectId(p.corpId));
  const existing = await collection
    .find(
      { aiListed: true, corporationId: { $in: corpObjectIds } },
      { projection: { volumeCap: 1, pricePremium: 1, expiresAtTurn: 1 } }
    )
    .toArray();
  const existingById = new Map(existing.map((e) => [e._id, e]));
  const slotByCorp = new Map<string, number>();
  const wanted = new Set<string>();
  const writes = [];
  for (const spec of desired) {
    const id = aiListingId(spec);
    wanted.add(id);
    const slot = slotByCorp.get(spec.corpId) ?? 0;
    slotByCorp.set(spec.corpId, slot + 1);
    const prior = existingById.get(id);
    const volumeCap = Math.round(spec.volumeCap * 100) / 100;
    if (
      prior &&
      prior.pricePremium === spec.pricePremium &&
      Math.abs(prior.volumeCap - volumeCap) <= prior.volumeCap * 0.05 &&
      prior.expiresAtTurn > turn + AI_LISTING_TTL_TURNS / 2
    ) {
      continue;
    }
    const row: SupplyListing = {
      _id: id,
      corporationId: new ObjectId(spec.corpId),
      aiListed: true,
      slot,
      side: spec.side,
      commodity: spec.commodity,
      ...(spec.stateId ? { stateId: spec.stateId } : {}),
      volumeCap,
      pricePremium: spec.pricePremium,
      expiresAtTurn: turn + AI_LISTING_TTL_TURNS,
      updatedAt: now,
    };
    writes.push({ replaceOne: { filter: { _id: id }, replacement: row, upsert: true } });
  }
  const stale = existing.filter((e) => !wanted.has(e._id)).map((e) => e._id);
  await Promise.all([
    writes.length > 0 ? collection.bulkWrite(writes, { ordered: false }) : null,
    stale.length > 0 ? collection.deleteMany({ _id: { $in: stale }, aiListed: true }) : null,
  ]);
  return { upserted: writes.length, removed: stale.length };
}

/**
 * Load NPP corps, run the matcher, persist accepts / cancel notices / new
 * active NPP-NPP contracts. No-ops when the flag is off.
 */
export async function processNppSupplyAgreements(
  db: Db,
  turn: number,
  now: Date,
  plantsEnabled: boolean
): Promise<{ accepted: number; cancelled: number; proposed: number }> {
  const cfg = await db
    .collection<GameConfig>("gameConfig")
    .findOne(
      { _id: "default" },
      { projection: { supplyAgreementsEnabled: 1, commandEconomyEnabled: 1 } }
    );
  if (cfg?.supplyAgreementsEnabled !== true) {
    return { accepted: 0, cancelled: 0, proposed: 0 };
  }
  const step = substepMarker();

  const nppCorps = await db
    .collection<Corporation>("corporations")
    .find(
      { ceoType: "npp", suspended: { $ne: true } },
      { projection: { countryId: 1, countryOwnerId: 1, ownershipState: 1, ceoType: 1 } }
    )
    .toArray();
  if (nppCorps.length === 0) return { accepted: 0, cancelled: 0, proposed: 0 };

  const corpIds = nppCorps.map((c) => c._id);
  // These reads share only the already-resolved NPP cohort. Launching them
  // together removes three sequential database waits from the turn's NPP
  // supply-agreement phase.
  const [sectors, rawAgreements, commodityPriceDocs, gameState, embargoes] = await Promise.all([
    db
      .collection<CorporateSector>("corporateSectors")
      .find({ corporationId: { $in: corpIds } }, { projection: NPP_SUPPLY_SECTOR_PROJECTION })
      .toArray(),
    db
      .collection<SupplyAgreement>("supplyAgreements")
      .find(
        {
          status: { $in: ["pending", "active", "cancelling"] },
          $or: [{ supplierCorpId: { $in: corpIds } }, { buyerCorpId: { $in: corpIds } }],
        },
        { projection: NPP_SUPPLY_AGREEMENT_PROJECTION }
      )
      .toArray(),
    db
      .collection<{
        commodity: string;
        turn?: number;
        basePrice?: number;
        globalPrice?: number;
        nationalPrices?: Record<string, number>;
      }>("commodityPrices")
      .find({})
      .toArray(),
    db
      .collection<GameState>("gameState")
      .findOne({ _id: "current" }, { projection: { currentYear: 1 } }),
    db
      .collection<TradeEmbargo>("tradeEmbargoes")
      .find(
        {
          mode: "block",
          $or: [{ expiresTurn: { $exists: false } }, { expiresTurn: { $gte: turn } }],
        },
        {
          projection: {
            sourceCountry: 1,
            targetCountry: 1,
            commodity: 1,
            direction: 1,
            mode: 1,
            expiresTurn: 1,
          },
        }
      )
      .toArray(),
  ]);
  step.mark("nppSupply.load");

  // Player buyers with a pending proposal at an AI supplier: one batched read.
  const externalBuyerIds = [
    ...new Set(
      rawAgreements
        .filter(
          (a) =>
            a.status === "pending" &&
            !corpIds.some((id) => id.equals(a.buyerCorpId)) &&
            a.proposedByCorpId?.equals(a.buyerCorpId)
        )
        .map((a) => a.buyerCorpId.toString())
    ),
  ];
  const externalBuyers = new Map<string, ExternalBuyer>();
  if (externalBuyerIds.length > 0) {
    const docs = await db
      .collection<Corporation>("corporations")
      .find(
        { _id: { $in: externalBuyerIds.map((id) => new ObjectId(id)) } },
        { projection: { countryId: 1 } }
      )
      .toArray();
    for (const d of docs) externalBuyers.set(d._id.toString(), { countryId: d.countryId });
  }
  const sectorsByCorp = new Map<string, CorporateSector[]>();
  for (const s of sectors) {
    const key = s.corporationId.toString();
    const list = sectorsByCorp.get(key) ?? [];
    list.push(s);
    sectorsByCorp.set(key, list);
  }

  const parties = nppCorps.map((c) => toParty(c, sectorsByCorp.get(c._id.toString()) ?? []));
  const nppIds = new Set(nppCorps.map((c) => c._id.toString()));

  const agreements: ExistingNppAgreement[] = rawAgreements.map(toExistingNppAgreement);

  const priceByCommodity = new Map<
    string,
    {
      turn?: number;
      basePrice?: number;
      globalPrice?: number;
      nationalPrices?: Record<string, number>;
    }
  >();
  for (const doc of commodityPriceDocs) {
    const existing = priceByCommodity.get(doc.commodity);
    if (!existing || (doc.turn ?? 0) >= (existing.turn ?? 0)) {
      priceByCommodity.set(doc.commodity, doc);
    }
  }
  const priceRatioOf = (commodity: CommodityType, countryId: string): number | null => {
    const doc = priceByCommodity.get(commodity);
    if (!doc?.basePrice) return null;
    const price = doc.nationalPrices?.[countryId] ?? doc.globalPrice;
    if (!price || !Number.isFinite(price)) return null;
    return price / doc.basePrice;
  };

  // Planned economies produce a different commodity from the same media plant
  // and are derated differently, so the capacity checks inside the matcher need
  // both to size a contract against what the sink will credit.
  const currentYear = gameState?.currentYear;
  const decisions = decideNppSupplyAgreements({
    turn,
    plantsEnabled,
    parties,
    agreements,
    priceRatioOf,
    staggerEligible: (id) => glutStaggerEligible(id, turn),
    currentYear,
    commandEconomyEnabled: cfg?.commandEconomyEnabled === true,
    externalBuyers,
    tradeBlocked: buildTradeBlocked({
      embargoes,
      turn,
      currentYear,
      commandEconomyEnabled: cfg?.commandEconomyEnabled === true,
    }),
  });

  step.mark("nppSupply.decide");
  const activations = decisions.filter(
    (decision): decision is Extract<NppAgreementDecision, { action: "activate" }> =>
      decision.action === "activate"
  );
  const cancellations = decisions.filter(
    (decision): decision is Extract<NppAgreementDecision, { action: "cancelNotice" }> =>
      decision.action === "cancelNotice"
  );
  let accepted = 0;
  let cancelled = 0;
  let proposed = 0;
  const inserts: SupplyAgreement[] = [];

  for (const d of decisions) {
    if (d.action === "propose") {
      if (!nppIds.has(d.supplierCorpId) || !nppIds.has(d.buyerCorpId)) continue;
      inserts.push({
        volumeCapBasis: "scaledCapacity",
        supplierCorpId: new ObjectId(d.supplierCorpId),
        buyerCorpId: new ObjectId(d.buyerCorpId),
        commodity: d.commodity,
        ...(d.stateId ? { stateId: d.stateId } : {}),
        volumeCap: d.volumeCap,
        pricePremium: d.pricePremium,
        exclusive: false,
        status: "active",
        proposedByCorpId: new ObjectId(d.supplierCorpId),
        createdAt: now,
        updatedAt: now,
      });
      proposed += 1;
    }
  }

  const agreementsCollection = db.collection<SupplyAgreement>("supplyAgreements");
  const durationById = new Map(agreements.map((a) => [a.id, a.durationTurns]));
  const [activationResult, cancellationResult] = await Promise.all([
    activations.length > 0
      ? agreementsCollection.bulkWrite(
          activations.map((decision) => {
            const durationTurns = durationById.get(decision.agreementId);
            return {
              updateOne: {
                filter: { _id: new ObjectId(decision.agreementId), status: "pending" },
                // Same lifecycle stamps as the player accept path.
                update: {
                  $set: {
                    status: "active" as const,
                    startsAtTurn: turn,
                    ...(durationTurns != null ? { expiresAtTurn: turn + durationTurns } : {}),
                    updatedAt: now,
                  },
                },
              },
            };
          })
        )
      : null,
    cancellations.length > 0
      ? agreementsCollection.bulkWrite(
          cancellations.map((decision) => ({
            updateOne: {
              filter: { _id: new ObjectId(decision.agreementId), status: "active" },
              update: {
                $set: {
                  status: "cancelling",
                  cancelEffectiveTurn: turn + CONTRACT_CANCEL_NOTICE_TURNS,
                  updatedAt: now,
                },
              },
            },
          }))
        )
      : null,
  ]);
  accepted = activationResult?.modifiedCount ?? 0;
  cancelled = cancellationResult?.modifiedCount ?? 0;

  if (inserts.length > 0) {
    await agreementsCollection.insertMany(inserts);
  }

  step.mark("nppSupply.write");

  await syncAiSupplyListings(db, {
    turn,
    now,
    plantsEnabled,
    parties,
    // Live and pending contracts, so spare capacity is net of committed volume.
    agreements,
    priceRatioOf,
    currentYear,
    commandEconomyEnabled: cfg?.commandEconomyEnabled === true,
  });
  step.mark("nppSupply.listings");
  return { accepted, cancelled, proposed };
}
