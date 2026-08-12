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

import type { Db } from "mongodb";
import { ObjectId } from "mongodb";
import type { Corporation, CorporateSector, GameConfig } from "@/lib/db/types";
import type { CommodityType } from "@/lib/constants/commodities";
import { SECTOR_DEMAND, SECTOR_SUPPLY } from "@/lib/constants/commodities";
import type { CorporationType } from "@/lib/constants/corporations";
import {
  CONTRACT_CANCEL_NOTICE_TURNS,
  CONTRACT_OVERCOMMIT_TOLERANCE,
  SUPPLY_AGREEMENT_PRICE_BAND,
  type SupplyAgreement,
} from "@/lib/db/types/supplyAgreement";
import { computeSupplierCommodityCapacityUnits } from "@/lib/corporations/supplyAgreementCapacity";
import { glutStaggerEligible } from "@/lib/turn/nppCorporationBehavior";
import { isStateOwned } from "@/lib/nationalization/nationalCorporation";
import { getEffectiveStrategyRates } from "@/lib/constants/sectorStrategies";

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
  sectors: Array<{
    sectorType: CorporationType;
    capitalStock?: number | null;
    producedUnits?: number | null;
    soldFraction?: number | null;
    throughputFactor?: number | null;
    mothballed?: boolean | null;
    strategyId?: string | null;
    transitionFromStrategyId?: string | null;
    transitionStartTurn?: number | null;
    productionPolicyLevel?: number | null;
    embargoSuspended?: boolean | null;
    embargoExportExposure?: number | null;
  }>;
};

export type ExistingNppAgreement = {
  id: string;
  supplierCorpId: string;
  buyerCorpId: string;
  commodity: CommodityType;
  volumeCap: number;
  pricePremium: number;
  status: SupplyAgreement["status"];
};

export type NppAgreementDecision =
  | { action: "activate"; agreementId: string }
  | { action: "cancelNotice"; agreementId: string }
  | {
      action: "propose";
      supplierCorpId: string;
      buyerCorpId: string;
      commodity: CommodityType;
      volumeCap: number;
      pricePremium: number;
    };

function liveStatuses(status: SupplyAgreement["status"]): boolean {
  return status === "pending" || status === "active" || status === "cancelling";
}

function commoditiesOf(
  sectorType: CorporationType,
  side: "supply" | "demand",
  strategyId: string | null | undefined,
  transitionFrom: string | null | undefined,
  transitionStart: number | null | undefined,
  turn: number
): CommodityType[] {
  const rates = getEffectiveStrategyRates(
    sectorType,
    strategyId ?? "standard",
    transitionFrom,
    transitionStart,
    turn
  );
  const mix = side === "supply" ? rates.supply : rates.demand;
  const fromStrategy = (Object.keys(mix) as CommodityType[]).filter((c) => (mix[c] ?? 0) > 0);
  if (fromStrategy.length > 0) return fromStrategy;
  const table = side === "supply" ? SECTOR_SUPPLY[sectorType] : SECTOR_DEMAND[sectorType];
  return (table ?? []).filter((f) => f.rate > 0).map((f) => f.commodity);
}

function sellerFill(party: NppAgreementParty, commodity: CommodityType, turn: number): number | null {
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
      turn
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
  priceRatio: number | null
): boolean {
  let uses = false;
  let worstThroughput = 1;
  for (const s of party.sectors) {
    if (s.mothballed === true) continue;
    const inputs = commoditiesOf(
      s.sectorType,
      "demand",
      s.strategyId,
      s.transitionFromStrategyId,
      s.transitionStartTurn,
      turn
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

function committedVolume(
  agreements: readonly ExistingNppAgreement[],
  supplierCorpId: string,
  commodity: CommodityType
): number {
  let sum = 0;
  for (const a of agreements) {
    if (a.supplierCorpId !== supplierCorpId || a.commodity !== commodity) continue;
    if (!liveStatuses(a.status)) continue;
    sum += a.volumeCap;
  }
  return sum;
}

function pairExists(
  agreements: readonly ExistingNppAgreement[],
  supplierCorpId: string,
  buyerCorpId: string,
  commodity: CommodityType
): boolean {
  return agreements.some(
    (a) =>
      a.supplierCorpId === supplierCorpId &&
      a.buyerCorpId === buyerCorpId &&
      a.commodity === commodity &&
      liveStatuses(a.status)
  );
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
  turn: number;
  plantsEnabled: boolean;
  parties: readonly NppAgreementParty[];
  agreements: readonly ExistingNppAgreement[];
  priceRatioOf: (commodity: CommodityType, countryId: string) => number | null;
  staggerEligible: (corpId: string) => boolean;
}): NppAgreementDecision[] {
  const { turn, plantsEnabled, parties, agreements, priceRatioOf, staggerEligible } = args;
  const byId = new Map(parties.map((p) => [p.corpId, p]));
  const out: NppAgreementDecision[] = [];
  const acceptedBuyer = new Set<string>();
  const proposedSupplier = new Set<string>();
  const proposedBuyer = new Set<string>();

  // 1. Auto-accept inbound pending proposals the NPP buyer actually needs.
  for (const a of agreements) {
    if (a.status !== "pending") continue;
    const buyer = byId.get(a.buyerCorpId);
    if (!buyer || buyer.isNatcorp) continue;
    if (!staggerEligible(buyer.corpId)) continue;
    if (acceptedBuyer.has(buyer.corpId)) continue;
    if (a.pricePremium > NPP_CONTRACT_MAX_ACCEPT_PREMIUM) continue;
    if (a.pricePremium < -SUPPLY_AGREEMENT_PRICE_BAND) continue;
    const uses = buyer.sectors.some((s) => {
      if (s.mothballed === true) return false;
      return commoditiesOf(
        s.sectorType,
        "demand",
        s.strategyId,
        s.transitionFromStrategyId,
        s.transitionStartTurn,
        turn
      ).includes(a.commodity);
    });
    if (!uses) continue;
    out.push({ action: "activate", agreementId: a.id });
    acceptedBuyer.add(buyer.corpId);
  }

  // 2. Serve cancel notice when the supplier has gone cold on that commodity.
  for (const a of agreements) {
    if (a.status !== "active") continue;
    const supplier = byId.get(a.supplierCorpId);
    if (!supplier) continue;
    if (!staggerEligible(supplier.corpId)) continue;
    const capacity = plantsEnabled
      ? computeSupplierCommodityCapacityUnits({
          sectors: supplier.sectors,
          commodity: a.commodity,
          isNatcorp: supplier.isNatcorp,
          turn,
        })
      : supplier.sectors.some(
          (s) =>
            s.mothballed !== true &&
            commoditiesOf(
              s.sectorType,
              "supply",
              s.strategyId,
              s.transitionFromStrategyId,
              s.transitionStartTurn,
              turn
            ).includes(a.commodity)
        )
        ? 1
        : 0;
    if (capacity > 0) continue;
    out.push({ action: "cancelNotice", agreementId: a.id });
  }

  if (!plantsEnabled) return out;

  // 3. Propose NPP-NPP same-country contracts into starved buyers.
  for (const supplier of parties) {
    if (supplier.isNatcorp) continue;
    if (!staggerEligible(supplier.corpId)) continue;
    if (proposedSupplier.has(supplier.corpId)) continue;

    type Candidate = {
      buyer: NppAgreementParty;
      commodity: CommodityType;
      volumeCap: number;
      pricePremium: number;
      score: number;
    };
    let best: Candidate | null = null;

    const outputSet = new Set<CommodityType>();
    for (const s of supplier.sectors) {
      if (s.mothballed === true) continue;
      for (const c of commoditiesOf(
        s.sectorType,
        "supply",
        s.strategyId,
        s.transitionFromStrategyId,
        s.transitionStartTurn,
        turn
      )) {
        outputSet.add(c);
      }
    }

    for (const commodity of outputSet) {
      const capacity = computeSupplierCommodityCapacityUnits({
        sectors: supplier.sectors,
        commodity,
        isNatcorp: supplier.isNatcorp,
        turn,
      });
      const uncommitted = Math.max(
        0,
        capacity * CONTRACT_OVERCOMMIT_TOLERANCE - committedVolume(agreements, supplier.corpId, commodity)
      );
      const volumeCap = uncommitted * NPP_CONTRACT_CAPACITY_SHARE;
      if (!(volumeCap > 0)) continue;

      const fill = sellerFill(supplier, commodity, turn);
      const priceRatio = priceRatioOf(commodity, supplier.countryId);
      const premium = nppContractPremium(fill, priceRatio);

      for (const buyer of parties) {
        if (buyer.corpId === supplier.corpId) continue;
        if (buyer.isNatcorp) continue;
        if (buyer.countryId !== supplier.countryId) continue;
        if (proposedBuyer.has(buyer.corpId) || acceptedBuyer.has(buyer.corpId)) continue;
        if (pairExists(agreements, supplier.corpId, buyer.corpId, commodity)) continue;
        const buyerRatio = priceRatioOf(commodity, buyer.countryId);
        if (!buyerStarved(buyer, commodity, turn, buyerRatio)) continue;
        const score =
          (fill == null ? 0.5 : 1 - fill) + Math.max(0, (buyerRatio ?? 1) - 1);
        if (!best || score > best.score) {
          best = { buyer, commodity, volumeCap, pricePremium: premium, score };
        }
      }
    }

    if (!best) continue;
    out.push({
      action: "propose",
      supplierCorpId: supplier.corpId,
      buyerCorpId: best.buyer.corpId,
      commodity: best.commodity,
      volumeCap: best.volumeCap,
      pricePremium: best.pricePremium,
    });
    proposedSupplier.add(supplier.corpId);
    proposedBuyer.add(best.buyer.corpId);
  }

  return out;
}

function toParty(corp: Corporation, sectors: CorporateSector[]): NppAgreementParty {
  return {
    corpId: corp._id.toString(),
    countryId: corp.countryId,
    isNatcorp: isStateOwned(corp),
    sectors: sectors.map((s) => ({
      sectorType: s.sectorType,
      capitalStock: s.capitalStock,
      producedUnits: s.producedUnits,
      soldFraction: s.soldFraction,
      throughputFactor: s.throughputFactor,
      mothballed: s.mothballed,
      strategyId: s.strategyId,
      transitionFromStrategyId: s.transitionFromStrategyId,
      transitionStartTurn: s.transitionStartTurn,
      productionPolicyLevel: s.productionPolicyLevel,
      embargoSuspended: s.embargoSuspended,
      embargoExportExposure: s.embargoExportExposure,
    })),
  };
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
    .findOne({ _id: "default" }, { projection: { supplyAgreementsEnabled: 1 } });
  if (cfg?.supplyAgreementsEnabled !== true) {
    return { accepted: 0, cancelled: 0, proposed: 0 };
  }

  const nppCorps = await db
    .collection<Corporation>("corporations")
    .find({ ceoType: "npp", suspended: { $ne: true } }, { projection: { countryId: 1, countryOwnerId: 1, ownershipState: 1 } })
    .toArray();
  if (nppCorps.length === 0) return { accepted: 0, cancelled: 0, proposed: 0 };

  const corpIds = nppCorps.map((c) => c._id);
  const sectors = await db
    .collection<CorporateSector>("corporateSectors")
    .find({ corporationId: { $in: corpIds } })
    .toArray();
  const sectorsByCorp = new Map<string, CorporateSector[]>();
  for (const s of sectors) {
    const key = s.corporationId.toString();
    const list = sectorsByCorp.get(key) ?? [];
    list.push(s);
    sectorsByCorp.set(key, list);
  }

  const parties = nppCorps.map((c) => toParty(c, sectorsByCorp.get(c._id.toString()) ?? []));

  const rawAgreements = await db
    .collection<SupplyAgreement>("supplyAgreements")
    .find({
      status: { $in: ["pending", "active", "cancelling"] },
      $or: [
        { supplierCorpId: { $in: corpIds } },
        { buyerCorpId: { $in: corpIds } },
      ],
    })
    .toArray();
  const agreements: ExistingNppAgreement[] = rawAgreements.map((a) => ({
    id: a._id!.toString(),
    supplierCorpId: a.supplierCorpId.toString(),
    buyerCorpId: a.buyerCorpId.toString(),
    commodity: a.commodity,
    volumeCap: a.volumeCap,
    pricePremium: a.pricePremium,
    status: a.status,
  }));

  const commodityPriceDocs = await db
    .collection<{
      commodity: string;
      turn?: number;
      basePrice?: number;
      globalPrice?: number;
      nationalPrices?: Record<string, number>;
    }>("commodityPrices")
    .find({})
    .toArray();
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

  const decisions = decideNppSupplyAgreements({
    turn,
    plantsEnabled,
    parties,
    agreements,
    priceRatioOf,
    staggerEligible: (id) => glutStaggerEligible(id, turn),
  });

  let accepted = 0;
  let cancelled = 0;
  let proposed = 0;
  const inserts: SupplyAgreement[] = [];

  for (const d of decisions) {
    if (d.action === "activate") {
      const res = await db.collection<SupplyAgreement>("supplyAgreements").updateOne(
        { _id: new ObjectId(d.agreementId), status: "pending" },
        { $set: { status: "active", updatedAt: now } }
      );
      if (res.modifiedCount > 0) accepted += 1;
    } else if (d.action === "cancelNotice") {
      const res = await db.collection<SupplyAgreement>("supplyAgreements").updateOne(
        { _id: new ObjectId(d.agreementId), status: "active" },
        {
          $set: {
            status: "cancelling",
            cancelEffectiveTurn: turn + CONTRACT_CANCEL_NOTICE_TURNS,
            updatedAt: now,
          },
        }
      );
      if (res.modifiedCount > 0) cancelled += 1;
    } else {
      inserts.push({
        volumeCapBasis: "scaledCapacity",
        supplierCorpId: new ObjectId(d.supplierCorpId),
        buyerCorpId: new ObjectId(d.buyerCorpId),
        commodity: d.commodity,
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

  if (inserts.length > 0) {
    await db.collection<SupplyAgreement>("supplyAgreements").insertMany(inserts);
  }

  return { accepted, cancelled, proposed };
}
