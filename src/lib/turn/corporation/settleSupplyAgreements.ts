/**
 * Bilateral supply-agreement settlement (supplyAgreementsEnabled).
 *
 * The clearing pre-pass already sells each supplier's contracted units at MARKET
 * price into the anonymous demand pool (the money-conserving baseline — those
 * units clear and land in `liquidCapital` via the normal revenue→income path).
 * A supply agreement additionally locks the price at `market × (1 + premium)`.
 * We settle that lock as a **contract-for-difference**: a discrete cash transfer
 * of the premium delta between buyer and supplier, layered on top of the market
 * baseline. This conserves total corp cash exactly (equal-and-opposite ₳ legs)
 * and never touches the fragile revenue/margin/tax/share-price legs.
 *
 * Per settled agreement:
 *   qty        = the supplier's contracted units that actually cleared, split
 *                across its agreements for that commodity pro-rata by volumeCap
 *   unitPriceₐ = COMMODITY_BASE_PRICES[commodity] × laggedPriceRatio  (in ₳)
 *   premiumₐ   = qty × unitPriceₐ × pricePremium
 *   supplier `liquidCapital` += premiumₐ (→ its currency); buyer -= premiumₐ.
 *
 * A positive premium ⇒ the buyer pays the supplier above market (guaranteed
 * supply at a locked, higher price); a negative premium ⇒ the supplier subsidises
 * the buyer (a discount). The base commodity sale is already taxed as ordinary
 * corp revenue; this side-payment is not taxed again.
 *
 * SHORTFALL (plants tier). A contract is a promise about physical goods, so a
 * supplier that PRODUCED less than it contracted owes the buyer damages:
 *
 *   shortfallUnits = contracted − produced   (pro-rated across the supplier's
 *                                             agreements for that commodity)
 *   penaltyₐ       = shortfallUnits × unitPriceₐ × CONTRACT_SHORTFALL_PENALTY
 *   supplier `liquidCapital` −= penaltyₐ; buyer += penaltyₐ.
 *
 * The test is deliberately PRODUCTION, not delivery: units the supplier made
 * but could not move because the market did not want them are a demand problem,
 * not a breach, and the supplier already eats that loss as unsold inventory.
 * Same cash-conserving, equal-and-opposite shape as the premium leg above, and
 * the same `corp_supply_agreement` tx type, so nothing downstream needs to
 * learn a new ledger row.
 */

import type { Db, AnyBulkWriteOperation, ObjectId } from "mongodb";
import type { Corporation } from "@/lib/db/types";
import type { CommodityType } from "@/lib/constants/commodities";
import { COMMODITY_BASE_PRICES } from "@/lib/constants/commodities";
import { safeUnitScale } from "@/lib/constants/capacityEconomy";
import {
  CONTRACT_DAMAGES_CAP_FRACTION,
  CONTRACT_SHORTFALL_PENALTY,
} from "@/lib/db/types/supplyAgreement";
import type { CurrencyCode } from "@/lib/constants/currencies";
import type { CorporationLookups } from "./types";
import type { TxThresholds, FinancialTxLogEntry } from "@/lib/db/types/financialTxLog";
import { emitTxBulk } from "@/lib/financialTxLog/emit";
import {
  resolveCorpLiquidCurrencyCode,
  fxRateForCorpFromMap,
  anchorToCorpCapital,
  corpCapitalToAnchor,
} from "@/lib/currency/corporationCapital";

export interface SettleableSupplyAgreement {
  supplierCorpId: string;
  buyerCorpId: string;
  commodity: CommodityType;
  /** Contracted units on the DAILY basis, matching sector capacity (clamped ≥ 0). */
  volumeCap: number;
  /** Price offset vs market, already clamped to ±SUPPLY_AGREEMENT_PRICE_BAND. */
  pricePremium: number;
  /**
   * Grandfather gate for the shortfall leg. `false` marks a contract signed
   * before the propose-time validator had any physical basis for `volumeCap`
   * (pre-plants), so damages must NOT be assessed on it — the supplier never
   * agreed to a number its plants were sized against. Absent/undefined means
   * "assess", which keeps every existing caller and test unchanged.
   */
  shortfallEligible?: boolean;
}

/** Per-corp economic identity the pure settlement needs (id, name, ccy, fx). */
export interface SettleCorpInfo {
  _id: ObjectId;
  name: string;
  ccy: CurrencyCode | undefined;
  fxRate: number;
  /**
   * The corp's liquid capital, in ₳ — the SOLVENCY FLOOR for damages (C6).
   *
   * Settlement `$inc`s a corp's balance with no lower bound, so an uncapped
   * damages leg could drive a supplier straight through zero and credit the
   * buyer cash that never existed. A payer pays what it HAS; the remainder is
   * logged as an unpaid shortfall, not wired.
   *
   * Optional so existing callers/tests that do not resolve balances keep the
   * pre-C6 behaviour (no floor) rather than silently settling everything to 0.
   */
  liquidCapitalAnchor?: number;
}

type TxInput = Omit<FinancialTxLogEntry, "_id" | "expiresAt" | "flagged">;

export interface SupplyAgreementSettlements {
  /** corpId → net liquidCapital delta (in that corp's currency). */
  deltaByCorp: Map<string, number>;
  txEntries: TxInput[];
  settledCount: number;
  totalPremiumAnchor: number;
}

/** Below this ₳ magnitude a settlement is not worth a write. */
const MIN_SETTLE_ANCHOR = 1;

/**
 * Pure settlement computation — no I/O. Given the active agreements, the units
 * that actually cleared per (supplier, commodity), lagged price ratios, and each
 * corp's currency/fx, returns the per-corp liquidCapital deltas and the ledger
 * rows. Cash conserves in ₳ by construction (equal-and-opposite legs).
 */
export function computeSupplyAgreementSettlements(args: {
  agreements: readonly SettleableSupplyAgreement[];
  contractSettlementByCorp: ReadonlyMap<string, ReadonlyMap<CommodityType, number>>;
  priceRatioByCommodity: ReadonlyMap<CommodityType, number>;
  /**
   * The world's era unit-basis scale (`getEraUnitScale(preset)`). Contract
   * volumes are capacity units on the WORLD's unit basis; the per-unit price
   * below is the modern base price × ratio, so on an era basis (scale > 1,
   * where units are era-priced and 1/scale the modern size) the ₳ per unit
   * must shrink by the same factor or every settlement over-prices by the era
   * ratio. 1 for every modern world.
   */
  eraUnitScale: number;
  corpInfo: (corpId: string) => SettleCorpInfo | undefined;
  /**
   * Plants tier: supplier corpId → commodity → units that corp actually
   * PRODUCED this turn. Supplied only when plants is on; absent ⇒ no shortfall
   * penalties are assessed and settlement is byte-identical to before.
   *
   * A MISSING (supplier, commodity) entry means zero production, not "unknown":
   * see the mothball note at the read site below.
   */
  producedByCorpCommodity?: ReadonlyMap<string, ReadonlyMap<CommodityType, number>>;
  /**
   * Plants gate, required whenever `producedByCorpCommodity` is supplied.
   *
   * The production sink is filled from each sector's measured `producedUnits`,
   * scaled through `plantsSupplyScaledUnits`. That field only exists under
   * plants; below plants the only comparable figure is the revenue nameplate
   * after the lagged-supply normalization, which is not production at all and
   * would assess damages off a bookkeeping figure. Today the only caller gates
   * the sink on plants, but that gate lives far from here, so this function
   * refuses the sink itself rather than trusting a distant condition.
   *
   * It is deliberately NOT fed from clearing's offered `s.units`: extraction is
   * excluded from the plants offer and stays on the nameplate there, so routing
   * the sink through clearing would hand this guard a nameplate for the world's
   * dominant commodity supplier while still passing the plants check.
   */
  plantsEnabled?: boolean;
  turn: number;
  now: Date;
}): SupplyAgreementSettlements {
  const { agreements, contractSettlementByCorp, priceRatioByCommodity, corpInfo, turn, now } = args;

  // FIX 4 guard: hard-refuse a production sink that did not come from plants.
  const producedByCorpCommodity =
    args.producedByCorpCommodity && args.plantsEnabled === true
      ? args.producedByCorpCommodity
      : undefined;
  if (args.producedByCorpCommodity && args.plantsEnabled !== true) {
    throw new Error(
      "computeSupplyAgreementSettlements: producedByCorpCommodity requires plantsEnabled — " +
        "outside plants those units are the post-normalization revenue nameplate, not production."
    );
  }

  // Total contracted volume per (supplier, commodity), so a supplier's actually-
  // cleared units divide across its agreements pro-rata by their caps.
  const capByGroup = new Map<string, number>();
  for (const a of agreements) {
    const key = `${a.supplierCorpId}:${a.commodity}`;
    capByGroup.set(key, (capByGroup.get(key) ?? 0) + a.volumeCap);
  }

  const deltaByCorp = new Map<string, number>();
  /** C6 solvency floor: ₳ each corp has already committed to pay this settlement. */
  const paidByCorp = new Map<string, number>();
  const txEntries: TxInput[] = [];
  let settledCount = 0;
  let totalPremiumAnchor = 0;

  for (const a of agreements) {
    if (a.volumeCap <= 0) continue;
    const filled = contractSettlementByCorp.get(a.supplierCorpId)?.get(a.commodity) ?? 0;
    const totalCap = capByGroup.get(`${a.supplierCorpId}:${a.commodity}`) ?? 0;
    if (totalCap <= 0) continue;
    const capShare = a.volumeCap / totalCap;

    const qty = filled * capShare;
    const unitPriceAnchor =
      ((COMMODITY_BASE_PRICES[a.commodity] ?? 0) / safeUnitScale(args.eraUnitScale)) *
      (priceRatioByCommodity.get(a.commodity) ?? 1);
    const premiumAnchor = filled > 0 ? qty * unitPriceAnchor * a.pricePremium : 0;

    // Shortfall damages: the supplier under-PRODUCED against its contracted
    // volume. The sink as a whole is undefined outside plants ⇒ no penalty.
    //
    // A MISSING entry inside a supplied sink is ZERO produced, never "unknown".
    // Clearing only records sellers with units > 0, so a corp that mothballed
    // its plants (or made exactly 0 of the contracted commodity) has no entry.
    // Reading that as "no data ⇒ no damages" made mothballing strictly cheaper
    // than under-producing: make 1 unit and pay near-full damages, make 0 and
    // pay nothing. The whole contracted volume is the shortfall instead.
    //
    // `shortfallEligible === false` grandfathers a contract out of the damages
    // leg entirely: its `volumeCap` was never validated against anything the
    // plants could physically make, so a penalty on it would be arbitrary.
    const produced =
      producedByCorpCommodity && a.shortfallEligible !== false
        ? (producedByCorpCommodity.get(a.supplierCorpId)?.get(a.commodity) ?? 0)
        : undefined;
    const shortfallUnits =
      typeof produced === "number" && Number.isFinite(produced)
        ? Math.max(0, (totalCap - produced) * capShare)
        : 0;
    // C6 — DAMAGES ARE CAPPED AT A FRACTION OF THE CONTRACT'S OWN NOTIONAL.
    // Uncapped, this line is an unbounded wire between two consenting corps:
    // the pair that signs the contract also sets `volumeCap`, so two colluding
    // players could move any amount of cash, in either direction, every turn,
    // by contracting for a volume neither plant could ever make. The notional
    // is this contract's own `volumeCap × unit price` for the period, so the
    // ceiling scales with the deal actually struck and nothing else.
    const notionalAnchor = Math.max(0, a.volumeCap) * unitPriceAnchor;
    const uncappedPenaltyAnchor = shortfallUnits * unitPriceAnchor * CONTRACT_SHORTFALL_PENALTY;
    const penaltyAnchor = Math.min(
      uncappedPenaltyAnchor,
      notionalAnchor * CONTRACT_DAMAGES_CAP_FRACTION
    );

    // Supplier's net position: it is credited the premium and debited damages.
    const rawNetAnchor = premiumAnchor - penaltyAnchor;
    if (!Number.isFinite(rawNetAnchor) || Math.abs(rawNetAnchor) < MIN_SETTLE_ANCHOR) continue;

    const supplier = corpInfo(a.supplierCorpId);
    const buyer = corpInfo(a.buyerCorpId);
    if (!supplier || !buyer) continue;

    // C6 — SOLVENCY FLOOR. Whichever side is NET PAYING pays what it has and no
    // more; the unpaid remainder is logged, not wired. `paidByCorp` tracks the
    // running spend inside this settlement so a corp with ten contracts cannot
    // pay its whole balance ten times over.
    const payerId = rawNetAnchor < 0 ? a.supplierCorpId : a.buyerCorpId;
    const payer = rawNetAnchor < 0 ? supplier : buyer;
    const owedAnchor = Math.abs(rawNetAnchor);
    let netAnchor = rawNetAnchor;
    let unpaidAnchor = 0;
    if (
      typeof payer.liquidCapitalAnchor === "number" &&
      Number.isFinite(payer.liquidCapitalAnchor)
    ) {
      const available = Math.max(0, payer.liquidCapitalAnchor - (paidByCorp.get(payerId) ?? 0));
      const payable = Math.min(owedAnchor, available);
      unpaidAnchor = owedAnchor - payable;
      paidByCorp.set(payerId, (paidByCorp.get(payerId) ?? 0) + payable);
      netAnchor = rawNetAnchor < 0 ? -payable : payable;
      if (Math.abs(netAnchor) < MIN_SETTLE_ANCHOR) continue;
    }

    const supplierLocal = Math.round(anchorToCorpCapital(netAnchor, supplier.ccy, supplier.fxRate));
    const buyerLocal = Math.round(anchorToCorpCapital(netAnchor, buyer.ccy, buyer.fxRate));
    if (!Number.isFinite(supplierLocal) || !Number.isFinite(buyerLocal)) continue;
    if (supplierLocal === 0 && buyerLocal === 0) continue;

    // Supplier is credited its net position; buyer is debited it (each in its
    // own ccy). A net-negative position (damages exceeding the premium) simply
    // reverses the direction of both legs.
    deltaByCorp.set(a.supplierCorpId, (deltaByCorp.get(a.supplierCorpId) ?? 0) + supplierLocal);
    deltaByCorp.set(a.buyerCorpId, (deltaByCorp.get(a.buyerCorpId) ?? 0) - buyerLocal);
    settledCount++;
    totalPremiumAnchor += premiumAnchor;

    const meta = {
      commodity: a.commodity,
      unitsSettled: Math.round(qty),
      pricePremium: a.pricePremium,
      premiumAnchor: Math.round(premiumAnchor),
      ...(shortfallUnits > 0
        ? {
            shortfallUnits: Math.round(shortfallUnits),
            shortfallPenaltyAnchor: Math.round(penaltyAnchor),
            ...(uncappedPenaltyAnchor > penaltyAnchor
              ? { damagesCappedFromAnchor: Math.round(uncappedPenaltyAnchor) }
              : {}),
          }
        : {}),
      ...(unpaidAnchor >= MIN_SETTLE_ANCHOR
        ? { unpaidDamagesAnchor: Math.round(unpaidAnchor) }
        : {}),
    };
    if (supplier.ccy) {
      txEntries.push({
        type: "corp_supply_agreement",
        turn,
        createdAt: now,
        subjectType: "corporation",
        subjectId: supplier._id,
        subjectName: supplier.name,
        amount: supplierLocal,
        currencyCode: supplier.ccy,
        counterpartyType: "corporation",
        counterpartyId: buyer._id,
        meta: { ...meta, counterpartyCorpId: a.buyerCorpId },
      });
    }
    if (buyer.ccy) {
      txEntries.push({
        type: "corp_supply_agreement",
        turn,
        createdAt: now,
        subjectType: "corporation",
        subjectId: buyer._id,
        subjectName: buyer.name,
        amount: -buyerLocal,
        currencyCode: buyer.ccy,
        counterpartyType: "corporation",
        counterpartyId: supplier._id,
        meta: { ...meta, counterpartyCorpId: a.supplierCorpId },
      });
    }
  }

  return { deltaByCorp, txEntries, settledCount, totalPremiumAnchor };
}

/** I/O wrapper: compute settlements from lookups, then apply them to the DB. */
export async function settleSupplyAgreements(args: {
  db: Db;
  lookups: CorporationLookups;
  agreements: SettleableSupplyAgreement[];
  contractSettlementByCorp: Map<string, Map<CommodityType, number>>;
  priceRatioByCommodity: ReadonlyMap<CommodityType, number>;
  /** Plants tier: supplier corpId -> commodity -> units actually produced. */
  producedByCorpCommodity?: ReadonlyMap<string, ReadonlyMap<CommodityType, number>>;
  /** Required alongside `producedByCorpCommodity` — see the guard in the pure fn. */
  plantsEnabled?: boolean;
  turn: number;
  now: Date;
  thresholds: TxThresholds;
}): Promise<{ settledCount: number; totalPremiumAnchor: number }> {
  const { db, lookups, agreements, contractSettlementByCorp, priceRatioByCommodity, turn, now } =
    args;
  if (agreements.length === 0) return { settledCount: 0, totalPremiumAnchor: 0 };

  const { deltaByCorp, txEntries, settledCount, totalPremiumAnchor } =
    computeSupplyAgreementSettlements({
      agreements,
      contractSettlementByCorp,
      priceRatioByCommodity,
      eraUnitScale: lookups.eraUnitScale,
      producedByCorpCommodity: args.producedByCorpCommodity,
      plantsEnabled: args.plantsEnabled,
      corpInfo: (corpId) => {
        const corp = lookups.corpById.get(corpId);
        if (!corp) return undefined;
        return {
          _id: corp._id,
          name: corp.name,
          ccy: resolveCorpLiquidCurrencyCode(corp),
          fxRate: fxRateForCorpFromMap(corp, lookups.exchangeRatesByCurrency),
          // C6 solvency floor: the payer's own balance, in ₳.
          liquidCapitalAnchor: corpCapitalToAnchor(
            corp.liquidCapital ?? 0,
            resolveCorpLiquidCurrencyCode(corp),
            fxRateForCorpFromMap(corp, lookups.exchangeRatesByCurrency)
          ),
        };
      },
      turn,
      now,
    });

  if (deltaByCorp.size > 0) {
    const ops: AnyBulkWriteOperation<Corporation>[] = [];
    for (const [corpId, delta] of deltaByCorp) {
      if (delta === 0) continue;
      const corp = lookups.corpById.get(corpId);
      if (!corp) continue;
      ops.push({
        updateOne: {
          filter: { _id: corp._id },
          update: { $inc: { liquidCapital: delta }, $set: { updatedAt: now } },
        },
      });
      // Keep the in-memory snapshot consistent for any later same-turn reader.
      corp.liquidCapital = (corp.liquidCapital ?? 0) + delta;
    }
    if (ops.length > 0) await db.collection<Corporation>("corporations").bulkWrite(ops);
  }
  if (txEntries.length > 0) await emitTxBulk(db, txEntries, args.thresholds);

  return { settledCount, totalPremiumAnchor };
}
