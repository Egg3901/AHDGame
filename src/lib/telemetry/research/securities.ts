/**
 * Shell for the research securities panel (#2332).
 *
 * One row per (world, turn) carrying every listed equity and every live bond,
 * written from `stateEffectsPhase` after the turn's trades and snapshots have
 * landed. Seven batched reads, one upsert. Nothing here changes market rules:
 * it observes quotes, executions and holdings exactly as stored, labels how
 * each price was produced, and aggregates holders to classes (no identities).
 */
import type { Db } from "mongodb";
import { BOND_UNIT_FACE_VALUE, perTurnCouponPayment } from "@/lib/constants/bonds";
import { getSecurityTelemetryCollection } from "@/lib/db/collections/researchTelemetry";
import type { Bond } from "@/lib/db/types/bond";
import { BOND_MARKET_POOLS_COLLECTION, type BondMarketPool } from "@/lib/db/types/bondMarketPool";
import type { Corporation, ShareOrder } from "@/lib/db/types/corporation";
import type { CorporationHistory } from "@/lib/db/types/corporationHistory";
import type { ExchangeRate } from "@/lib/db/types/exchangeRate";
import type { ShareTradeHistory } from "@/lib/db/types/shareTradeHistory";
import type { LongHorizonContext } from "@/lib/telemetry/longHorizon/telemetry";
import {
  bondUnitsByHolderClass,
  buildSecurityTelemetryRow,
  finiteOrNull,
  summarizeBook,
  summarizeExecutions,
  RESEARCH_MAX_SECURITIES_PER_ROW,
  type MarketPoolRow,
  type SecurityTelemetryRow,
  type SecurityTurnRow,
} from "./rules";

/** Trade kinds that are price-forming executions between two parties. */
const EXECUTION_KINDS = ["market_buy", "market_sell", "limit_fill", "peer_fill", "listing_fill"];

export async function buildSecurityTelemetryRowForTurn(
  db: Db,
  ctx: LongHorizonContext,
  turn: number,
  observedAt: Date
): Promise<SecurityTelemetryRow> {
  const [corporations, history, trades, orders, bonds, pools, rates] = await Promise.all([
    db
      .collection<Corporation>("corporations")
      .find(
        { hiddenFromExchange: { $ne: true }, isPrivate: { $ne: true } },
        {
          projection: {
            countryId: 1,
            sharePrice: 1,
            fundamentalSharePrice: 1,
            totalShares: 1,
            publicFloat: 1,
            liquidCurrencyCode: 1,
            liquidCapital: 1,
            countryOwnerId: 1,
          },
        }
      )
      .toArray(),
    db
      .collection<CorporationHistory>("corporationHistory")
      .find(
        { turn },
        {
          projection: {
            corporationId: 1,
            revenue: 1,
            income: 1,
            dividendPaidPerTurn: 1,
            currencyCode: 1,
            fxRateAtWrite: 1,
          },
        }
      )
      .toArray(),
    db
      .collection<ShareTradeHistory>("shareTradeHistory")
      .find(
        { turn, kind: { $in: EXECUTION_KINDS as ShareTradeHistory["kind"][] } },
        { projection: { corporationId: 1, shares: 1, totalAnchor: 1 } }
      )
      .toArray(),
    db
      .collection<ShareOrder>("shareOrders")
      .find(
        { status: "open", sharesRemaining: { $gt: 0 } },
        {
          projection: {
            corporationId: 1,
            type: 1,
            pricePerShare: 1,
            sharesRemaining: 1,
            liquidityProvider: 1,
          },
        }
      )
      .toArray(),
    db
      .collection<Bond>("bonds")
      .find({ matured: { $ne: true } })
      .project<Bond>({
        issuerType: 1,
        countryId: 1,
        corporationId: 1,
        currencyCode: 1,
        couponRate: 1,
        maturityTurn: 1,
        marketPrice: 1,
        totalIssued: 1,
        publicFloat: 1,
        centralBankHoldings: 1,
        defaulted: 1,
        matured: 1,
        holders: 1,
      })
      .toArray(),
    db.collection<BondMarketPool>(BOND_MARKET_POOLS_COLLECTION).find({}).toArray(),
    db.collection<ExchangeRate>("exchangeRates").find({}).toArray(),
  ]);

  const fxByCurrency = new Map<string, number>(
    rates.filter((r) => Number.isFinite(r.rate) && r.rate > 0).map((r) => [r.currencyCode, r.rate])
  );
  const historyByCorp = new Map(history.map((h) => [String(h.corporationId), h]));
  const tradesByCorp = new Map<string, ShareTradeHistory[]>();
  for (const t of trades) {
    const list = tradesByCorp.get(String(t.corporationId)) ?? [];
    list.push(t);
    tradesByCorp.set(String(t.corporationId), list);
  }
  const ordersByCorp = new Map<string, ShareOrder[]>();
  for (const o of orders) {
    const list = ordersByCorp.get(String(o.corporationId)) ?? [];
    list.push(o);
    ordersByCorp.set(String(o.corporationId), list);
  }

  const securities: SecurityTurnRow[] = [];

  for (const corp of corporations) {
    const id = String(corp._id);
    const currency = corp.liquidCurrencyCode ?? null;
    const fx = currency ? (fxByCurrency.get(currency) ?? null) : null;
    const executions = summarizeExecutions(tradesByCorp.get(id) ?? []);
    const h = historyByCorp.get(id);
    const totalShares = finiteOrNull(corp.totalShares);
    const modelPrice = finiteOrNull(corp.sharePrice);
    // An executed price is recorded in anchor; the local equivalent needs FX.
    const executedLocal =
      executions.vwapAnchor !== null && fx !== null ? executions.vwapAnchor * fx : null;
    const dividendTotal = finiteOrNull(h?.dividendPaidPerTurn);
    securities.push({
      securityId: `equity:${id}`,
      assetClass: "equity",
      issuerType: corp.countryOwnerId ? "state-enterprise" : "corporation",
      issuerCountry: corp.countryId ?? null,
      currencyCode: currency,
      fxRate: fx,
      fxStatus: fx !== null ? "converted" : "missing-fx",
      price: executedLocal ?? modelPrice,
      priceBasis: executedLocal !== null ? "executed" : "model",
      modelPrice,
      lastExecutedPriceAnchor: executions.vwapAnchor,
      executions,
      book: summarizeBook(
        (ordersByCorp.get(id) ?? []).map((o) => ({
          type: o.type,
          pricePerShare: o.pricePerShare,
          sharesRemaining: o.sharesRemaining,
          ...(o.liquidityProvider ? { liquidityProvider: true } : {}),
        }))
      ),
      unitsOutstanding: totalShares,
      publicFloat: finiteOrNull(corp.publicFloat),
      distributionPerUnit:
        dividendTotal !== null && totalShares !== null && totalShares > 0
          ? dividendTotal / totalShares
          : null,
      fundamentals: {
        revenue: finiteOrNull(h?.revenue),
        income: finiteOrNull(h?.income),
        liquidCapital: finiteOrNull(corp.liquidCapital),
      },
      bond: null,
    });
  }

  for (const bond of bonds) {
    const id = String(bond._id);
    const currency = bond.currencyCode ?? null;
    const fx = currency ? (fxByCurrency.get(currency) ?? null) : null;
    const price = finiteOrNull(bond.marketPrice);
    const byClass = bondUnitsByHolderClass(
      bond.holders ?? [],
      bond.publicFloat,
      bond.centralBankHoldings
    );
    securities.push({
      securityId: `bond:${id}`,
      assetClass: "bond",
      issuerType: bond.issuerType === "sovereign" ? "sovereign" : "corporation",
      issuerCountry: bond.issuerType === "sovereign" ? (bond.countryId ?? null) : null,
      currencyCode: currency,
      fxRate: fx,
      fxStatus: fx !== null ? "converted" : "missing-fx",
      // Bond prices are the model's mark, never an observed trade.
      price: price !== null ? price * BOND_UNIT_FACE_VALUE : null,
      priceBasis: "model",
      modelPrice: price !== null ? price * BOND_UNIT_FACE_VALUE : null,
      lastExecutedPriceAnchor: null,
      executions: { count: 0, units: 0, valueAnchor: 0, vwapAnchor: null },
      book: null,
      unitsOutstanding:
        finiteOrNull(bond.totalIssued) !== null
          ? (bond.totalIssued as number) / BOND_UNIT_FACE_VALUE
          : null,
      publicFloat: finiteOrNull(bond.publicFloat),
      distributionPerUnit: bond.defaulted
        ? 0
        : perTurnCouponPayment(finiteOrNull(bond.couponRate) ?? 0, BOND_UNIT_FACE_VALUE),
      fundamentals: { revenue: null, income: null, liquidCapital: null },
      bond: {
        couponRate: finiteOrNull(bond.couponRate) ?? 0,
        maturityTurn: finiteOrNull(bond.maturityTurn) ?? 0,
        defaulted: bond.defaulted === true,
        matured: bond.matured === true,
        unitsByHolderClass: byClass,
        hasHolders: Object.values(byClass).some((units) => units > 0),
      },
    });
  }

  if (securities.length > RESEARCH_MAX_SECURITIES_PER_ROW) {
    throw new Error(
      `securityTelemetry row for turn ${turn} has ${securities.length} securities, over the ${RESEARCH_MAX_SECURITIES_PER_ROW} per-document ceiling`
    );
  }

  const poolRows: MarketPoolRow[] = pools.map((p) => ({
    pool: "bond",
    currencyCode: String(p._id),
    cashLocal: finiteOrNull(p.cashLocal),
    targetCashLocal: finiteOrNull(p.targetCashLocal),
  }));

  return buildSecurityTelemetryRow({
    worldId: ctx.worldId,
    sourceClass: ctx.sourceClass,
    ...(ctx.runId !== undefined ? { runId: ctx.runId } : {}),
    ...(ctx.seed !== undefined ? { seed: ctx.seed } : {}),
    ...(ctx.codeVersion !== undefined ? { codeVersion: ctx.codeVersion } : {}),
    turn,
    year: ctx.year,
    foundingTurn: ctx.foundingTurn,
    observedAt,
    securities,
    pools: poolRows,
  });
}

/** Record the securities row for `turn`. Idempotent per (world, turn). */
export async function appendSecurityTelemetry(
  db: Db,
  ctx: LongHorizonContext,
  turn: number,
  observedAt: Date = new Date()
): Promise<number> {
  const row = await buildSecurityTelemetryRowForTurn(db, ctx, turn, observedAt);
  await getSecurityTelemetryCollection(db).replaceOne(
    { worldId: row.worldId, turn: row.turn },
    row,
    { upsert: true }
  );
  return row.securities.length;
}
