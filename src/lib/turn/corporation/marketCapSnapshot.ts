import type { Db, ObjectId } from "mongodb";
import type {
  Corporation,
  CorporateSector,
  MarketCapHistory,
  CorporationHistory,
} from "@/lib/db/types";
import type { CorporationType } from "@/lib/constants/corporations";
import { buildCommodityOutputSnapshot } from "@/lib/corporations/corpCommoditySnapshot";
import type { CurrencyCode } from "@/lib/constants/currencies";
import { logWireEvent, wireHeadlineCorpCreditRating } from "@/lib/wireEvent";
import { createNotifications } from "@/lib/notifications";
import type { CorpSnapshot } from "./types";
import { ALL_EXCHANGES, getExchangeApiKey } from "@/lib/constants/exchangeRegistry";
import {
  resolveCorpLiquidCurrencyCode,
  type CorpCapitalCurrencyInfo,
} from "@/lib/currency/corporationCapital";
import { readCorpEconomicAnchor, writeCorpEconomicLocal } from "@/lib/currency/corpEconomyFields";
import { runLaunchGuard } from "@/lib/market/launchGuard";

/**
 * Currency to DENOMINATE a corp's history rows in. Returns a `code` ONLY when
 * its FX rate is present AND usable (finite, > 0); otherwise ₳ (no code, rate 1).
 *
 * Guards the trap in #2973: a resolvable code whose rate is missing/0 from the
 * map would otherwise fall back to writing unconverted ₳ while still stamping
 * `currencyCode`, and readers (ChartsTab) then divide by the live rate and
 * under-report by the full FX factor. When we can't convert, we must not label.
 */
export function resolveSnapshotDenomination(
  corp: CorpCapitalCurrencyInfo,
  fxByCurrency: ReadonlyMap<CurrencyCode, number>
): { code: CurrencyCode | undefined; rate: number } {
  const code = resolveCorpLiquidCurrencyCode(corp);
  const rawRate = code != null ? fxByCurrency.get(code) : undefined;
  const usable = rawRate != null && Number.isFinite(rawRate) && rawRate > 0;
  return { code: usable ? code : undefined, rate: usable ? rawRate : 1 };
}

/** The same universe the stock-exchange snapshot exposes as tradeable listings. */
export function isStockMarketCorporation(
  corp: Pick<Corporation, "isPrivate" | "hiddenFromExchange">
): boolean {
  return corp.isPrivate !== true && corp.hiddenFromExchange !== true;
}

function convertMapToLocalRecord(
  m: Map<string, number>,
  code: CurrencyCode | undefined,
  rate: number
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, vAnchor] of m) out[k] = Math.round(writeCorpEconomicLocal(vAnchor, code, rate));
  return out;
}

/**
 * Fold a corp's dividend-received-deduction tax (anchor, per home country) into
 * copies of its combined + domestic per-country tax maps, and return the total
 * folded amount. Pure and non-mutating (the input maps are shared with the tax
 * ledger emitter, which must not see the tax twice). Non-positive per-country
 * amounts are skipped. See #3115.
 */
export function foldDividendTaxIntoTaxMaps(
  taxByCountry: ReadonlyMap<string, number>,
  taxByCountryDomestic: ReadonlyMap<string, number>,
  divTaxByCountry: ReadonlyMap<string, number> | undefined
): {
  mergedTaxByCountry: Map<string, number>;
  mergedTaxByCountryDomestic: Map<string, number>;
  divTaxTotalAnchor: number;
} {
  const mergedTaxByCountry = new Map(taxByCountry);
  const mergedTaxByCountryDomestic = new Map(taxByCountryDomestic);
  let divTaxTotalAnchor = 0;
  if (divTaxByCountry) {
    for (const [cid, taxAnchor] of divTaxByCountry) {
      if (taxAnchor <= 0) continue;
      divTaxTotalAnchor += taxAnchor;
      mergedTaxByCountry.set(cid, (mergedTaxByCountry.get(cid) ?? 0) + taxAnchor);
      mergedTaxByCountryDomestic.set(cid, (mergedTaxByCountryDomestic.get(cid) ?? 0) + taxAnchor);
    }
  }
  return { mergedTaxByCountry, mergedTaxByCountryDomestic, divTaxTotalAnchor };
}

export async function snapshotMarketCap(
  db: Db,
  turn: number,
  corporations: Corporation[],
  corpSnapshots: CorpSnapshot[],
  corpById: Map<string, Corporation>,
  fxByCurrency: ReadonlyMap<CurrencyCode, number>,
  now: Date,
  // Injectable [0,1) source, same pattern as decideNppAction
  // (src/lib/npp/actionAi.ts) — defaults to Math.random so any future test
  // spying on it keeps working; the turn-path caller passes a seeded stream
  // (see turnPhaseRegistry.ts / turn/corporation/index.ts) per the "never
  // Math.random() in turn paths" doctrine (src/lib/events/substrate/rng.ts).
  rng: () => number = Math.random,
  sectorsByCorp?: Map<string, CorporateSector[]>,
  // Net dividend income (local ccy, per-turn) each corp received from holdings
  // this turn — reporting only (cash already credited in Phase 3c). Persisted so
  // the Financials can surface a "Dividend income (holdings)" P&L line (#3109).
  dividendIncomeReceivedByCorpId?: Map<string, number>,
  // 50% dividend-received-deduction federal tax each corp owes this turn, keyed
  // corpId → countryId → ₳ (anchor). Folded into this row's tax fields here
  // because the row is INSERTED in Phase 8; the Phase-3c writer that produced it
  // ran before the row existed, so its updateOne no-op'd (#3115). Home-country
  // domestic federal tax, so it lands in federal/combined + the domestic split.
  dividendTaxPaidByCountry?: Map<string, Map<string, number>>
): Promise<void> {
  let globalCap = 0;
  // Aggregate fundamental valuation, and the slice of globalCap it accounts
  // for — both consumed by the launch guard below.
  let fundamentalCap = 0;
  let fundamentalCoveredCap = 0;
  // Per-exchange accumulation — keyed by apiKey (e.g. "nyse", "ftse", "nikkei")
  const exchangeCaps: Record<string, number> = {};
  for (const ex of ALL_EXCHANGES) exchangeCaps[ex.apiKey] = 0;

  const bySector: Partial<Record<CorporationType, number>> = {};

  const snapshotByCorpId = new Map(corpSnapshots.map((s) => [s.corpId.toString(), s]));

  // Resolve each corp's home currency + rate once. Used to (a) normalize the
  // per-corp sharePrice to ₳ for cross-corp market-cap aggregation, and
  // (b) re-denominate the ₳-valued corp turn outputs into the corp's local
  // currency when writing per-corp history rows.
  const currencyByCorpId = new Map<string, { code: CurrencyCode | undefined; rate: number }>();
  for (const corp of corporations) {
    currencyByCorpId.set(corp._id.toString(), resolveSnapshotDenomination(corp, fxByCurrency));
  }

  for (const corp of corporations) {
    const snapshot = snapshotByCorpId.get(corp._id.toString());
    const sharePrice = snapshot?.actualSharePrice ?? corp.sharePrice ?? 0.1;
    const totalShares = snapshot?.totalShares ?? corp.totalShares ?? 10_000_000;
    // Post-Task-18A, sharePrice is in the corp's home currency. Normalize to ₳
    // so cross-corp sums (globalCap, per-exchange, by-sector) don't mix units.
    // Pre-Task-18A, sharePrice is still ₳ and this is a passthrough.
    const fx = currencyByCorpId.get(corp._id.toString());
    const sharePriceAnchor = readCorpEconomicAnchor(sharePrice, fx?.code, fx?.rate ?? 1);
    const capAnchor = sharePriceAnchor * totalShares;
    // Per-corp histories include every enterprise. Stock-market aggregates do not: private
    // and hidden corporations have no tradeable listing and must not move the market chart.
    if (isStockMarketCorporation(corp)) {
      globalCap += capAnchor;

      // Parallel sum at the model's fundamental price, so the launch guard can
      // tell an honest repricing (price and value fall together, e.g. a prime-rate
      // rise discounting sectorNPV) from a market break (price alone falls).
      // Corps with no fundamental price are excluded and tracked as missing
      // coverage rather than counted at zero, which would fake a collapse.
      const fundamentalPrice = corp.fundamentalSharePrice;
      if (typeof fundamentalPrice === "number" && fundamentalPrice > 0) {
        fundamentalCap +=
          readCorpEconomicAnchor(fundamentalPrice, fx?.code, fx?.rate ?? 1) * totalShares;
        fundamentalCoveredCap += capAnchor;
      }

      // No `?? "US"`: a corp with no countryId must not be counted toward NYSE's
      // market cap.
      const apiKey = corp.countryId ? getExchangeApiKey(corp.countryId) : undefined;
      if (apiKey && exchangeCaps[apiKey] !== undefined) {
        exchangeCaps[apiKey] += capAnchor;
      }

      bySector[corp.type] = (bySector[corp.type] ?? 0) + capAnchor;
    }
  }

  // Launch guard: automated kill switch for the clearing/capital flip. Cheap
  // no-op unless opt-in (marketGuardEnabled) and the mode is clearing/capital.
  await runLaunchGuard(
    db,
    turn,
    globalCap,
    fundamentalCap > 0
      ? {
          aggregateFundamentalMcap: fundamentalCap,
          coverage: globalCap > 0 ? fundamentalCoveredCap / globalCap : 0,
        }
      : undefined
  );

  // Simulate intra-turn price range for candlestick charting (0.3–1.5% spread).
  function candleSpread(close: number): { high: number; low: number } {
    if (close <= 0) return { high: close, low: close };
    const pct = 0.003 + rng() * 0.012;
    const range = close * pct;
    const upFrac = 0.2 + rng() * 0.6;
    return {
      high: Math.round(close + range * upFrac),
      low: Math.max(1, Math.round(close - range * (1 - upFrac))),
    };
  }

  const globalSpread = candleSpread(globalCap);

  // Build per-exchange candlestick data
  const exchangeCapsFormatted: Record<string, { marketCap: number; high: number; low: number }> =
    {};
  for (const [key, cap] of Object.entries(exchangeCaps)) {
    const spread = candleSpread(cap);
    exchangeCapsFormatted[key] = { marketCap: Math.round(cap), high: spread.high, low: spread.low };
  }

  // Legacy fields for backward compat (NYSE/FTSE)
  const nyseData = exchangeCapsFormatted.nyse ?? { marketCap: 0, high: 0, low: 0 };
  const ftseData = exchangeCapsFormatted.ftse ?? { marketCap: 0, high: 0, low: 0 };

  const snapshot: Omit<MarketCapHistory, "_id"> = {
    turn,
    listingUniverse: "public-only",
    globalMarketCap: Math.round(globalCap),
    globalHigh: globalSpread.high,
    globalLow: globalSpread.low,
    // Legacy named fields (preserved for backward compat)
    nyseMarketCap: nyseData.marketCap,
    nyseHigh: nyseData.high,
    nyseLow: nyseData.low,
    ftseMarketCap: ftseData.marketCap,
    ftseHigh: ftseData.high,
    ftseLow: ftseData.low,
    // New format: per-exchange caps
    exchangeCaps: exchangeCapsFormatted,
    bySector: Object.fromEntries(
      Object.entries(bySector).map(([k, v]) => [k, Math.round(v)])
    ) as Partial<Record<CorporationType, number>>,
    createdAt: now,
  };

  // Upsert by turn so that if the turn runs more than once (e.g. cron retry),
  // the snapshot is replaced rather than appended, preventing duplicate points in charts.
  await db.collection("marketCapHistory").replaceOne({ turn }, snapshot, { upsert: true });

  // Per-corporation history snapshots
  if (corpSnapshots.length > 0) {
    const corpIdsForPrev = corpSnapshots.map((s) => s.corpId);
    const prevRatingRows = await db
      .collection<CorporationHistory>("corporationHistory")
      .aggregate<{ _id: ObjectId; lastRating: string }>([
        {
          $match: {
            corporationId: { $in: corpIdsForPrev },
            creditRating: { $exists: true, $type: "string" },
          },
        },
        { $sort: { turn: -1 } },
        { $group: { _id: "$corporationId", lastRating: { $first: "$creditRating" } } },
      ])
      .toArray();
    const prevRatingByCorp = new Map(prevRatingRows.map((r) => [r._id.toString(), r.lastRating]));

    // Per-corp history fields are denominated in the corp's home currency.
    // CorpSnapshot fields are mostly ₳-valued (revenue, income, tax, bond flows,
    // sectorNPV) — convert each to local via the corp's rate. liquidCapital is
    // already local (computed that way in sectorCalculations).
    //
    // sharePrice is now LOCAL in the snapshot (Task 18A re-denominated
    // finalPrices from anchor to corp currency before setting actualSharePrice).
    // Use it directly; marketCap = local × shares stays in local.
    const corpHistoryDocs: Omit<CorporationHistory, "_id">[] = corpSnapshots.map((s) => {
      const id = s.corpId.toString();
      const fx = currencyByCorpId.get(id);
      // resolveSnapshotDenomination already omits `code` when the rate isn't
      // genuinely known/usable (#2973), so this is safe to stamp directly —
      // and since it's a real rate whenever code is set, it doubles as the
      // write-time rate readers need to reconvert this row correctly later
      // instead of drifting with whatever the FX rate is at read time (#2958).
      const code = fx?.code;
      const rate = fx?.rate ?? 1;
      const localPrice = s.actualSharePrice;
      const sourceCorp = corpById.get(id);

      // Fold in this turn's dividend-received-deduction tax (#3115). It's a
      // home-country DOMESTIC federal tax, so it augments federalTaxPaid, the
      // combined corporateTaxPaid, and both the combined + domestic per-country
      // maps — keeping combined = domestic + foreign consistent. The helper
      // builds fresh maps so the shared snapshot (also read by the tax-ledger
      // emitter) is never mutated, which would double-count the tax there.
      const { mergedTaxByCountry, mergedTaxByCountryDomestic, divTaxTotalAnchor } =
        foldDividendTaxIntoTaxMaps(
          s.taxPaidByCountry,
          s.taxPaidByCountryDomestic,
          dividendTaxPaidByCountry?.get(id)
        );

      return {
        corporationId: s.corpId,
        turn,
        ...(code ? { currencyCode: code, fxRateAtWrite: rate } : {}),
        sharePrice: localPrice,
        totalShares: s.totalShares,
        // Snapshot the shareholder register so a future split / reverse split
        // is auditable (can reconstruct pre-split holdings). Stored as a deep
        // copy so later in-memory mutations of `corp.shareholders` don't
        // retroactively change the snapshot.
        ...(sourceCorp?.shareholders
          ? { shareholders: sourceCorp.shareholders.map((h) => ({ ...h })) }
          : {}),
        ...(sourceCorp?.publicFloat != null ? { publicFloat: sourceCorp.publicFloat } : {}),
        // Brand loyalty / quality time series (brandLoyaltyEnabled). corpById is
        // updated in-memory after the loyalty rollup, so these are current-turn.
        ...(sourceCorp?.brandLoyalty != null ? { brandLoyalty: sourceCorp.brandLoyalty } : {}),
        ...(sourceCorp?.averageQuality != null
          ? { averageQuality: sourceCorp.averageQuality }
          : {}),
        ...((): { commodityOutput?: Record<string, number> } => {
          if (!sectorsByCorp) return {};
          const sectors = sectorsByCorp.get(id);
          if (!sectors?.length) return {};
          const commodityOutput = buildCommodityOutputSnapshot(sectors, turn);
          return Object.keys(commodityOutput).length > 0 ? { commodityOutput } : {};
        })(),
        marketCap: Math.round(localPrice * s.totalShares),
        liquidCapital: Math.round(s.liquidCapital),
        // Snapshot the market-making buyback escrow (already in local currency) so
        // trace_corp / forensics can chart true net cash (liquidCapital + escrow) and
        // detect escrow going negative — the driver behind "the merger only gave me a
        // fraction of the target's cash" reports (takeover transfers the net, not gross).
        shareEscrowBalance: Math.round(s.escrowBalanceAfter),
        revenue: Math.round(writeCorpEconomicLocal(s.revenue, code, rate)),
        totalCosts: Math.round(writeCorpEconomicLocal(s.totalCosts, code, rate)),
        income: Math.round(writeCorpEconomicLocal(s.income, code, rate)),
        dividendPaidPerTurn: Math.round(writeCorpEconomicLocal(s.dividendPaidPerTurn, code, rate)),
        incomePreDividends: Math.round(writeCorpEconomicLocal(s.incomePreDividends, code, rate)),
        // Persisted so recomputeSharePricesAfterBondTurn can rebuild the
        // share-price formula's inputs without re-deriving from sectors/bonds.
        sectorNPV: Math.round(writeCorpEconomicLocal(s.sectorNPV, code, rate)),
        perTurnBondCouponIncome: Math.round(
          writeCorpEconomicLocal(s.perTurnBondCouponIncome, code, rate)
        ),
        perTurnBondInterestExpense: Math.round(
          writeCorpEconomicLocal(s.perTurnBondInterestExpense, code, rate)
        ),
        perTurnBondDragOnNetIncome: Math.round(
          writeCorpEconomicLocal(s.perTurnBondDragOnNetIncome, code, rate)
        ),
        corporateTaxPaid: Math.round(
          writeCorpEconomicLocal(s.federalTaxPaid + s.stateTaxPaid + divTaxTotalAnchor, code, rate)
        ),
        federalTaxPaid: Math.round(
          writeCorpEconomicLocal(s.federalTaxPaid + divTaxTotalAnchor, code, rate)
        ),
        stateTaxPaid: Math.round(writeCorpEconomicLocal(s.stateTaxPaid, code, rate)),
        // Omit the breakdown fields entirely when empty so single-jurisdiction corps
        // don't carry a noisy `{}` key in every history doc.
        ...(mergedTaxByCountry.size > 0
          ? { taxPaidByCountry: convertMapToLocalRecord(mergedTaxByCountry, code, rate) }
          : {}),
        ...(s.taxPaidByState.size > 0
          ? { taxPaidByState: convertMapToLocalRecord(s.taxPaidByState, code, rate) }
          : {}),
        // Domestic/foreign split of the same totals. Charts read these when present
        // and fall back to the combined taxPaidByCountry / taxPaidByState for pre-migration rows.
        ...(mergedTaxByCountryDomestic.size > 0
          ? {
              taxPaidByCountryDomestic: convertMapToLocalRecord(
                mergedTaxByCountryDomestic,
                code,
                rate
              ),
            }
          : {}),
        ...(s.taxPaidByCountryForeign.size > 0
          ? {
              taxPaidByCountryForeign: convertMapToLocalRecord(
                s.taxPaidByCountryForeign,
                code,
                rate
              ),
            }
          : {}),
        ...(s.taxPaidByStateDomestic.size > 0
          ? {
              taxPaidByStateDomestic: convertMapToLocalRecord(s.taxPaidByStateDomestic, code, rate),
            }
          : {}),
        ...(s.taxPaidByStateForeign.size > 0
          ? { taxPaidByStateForeign: convertMapToLocalRecord(s.taxPaidByStateForeign, code, rate) }
          : {}),
        marketingStrength: Math.round(s.marketingStrength * 100) / 100,
        logisticsStrength: s.logisticsStrength,
        dividendRate: s.dividendRate,
        creditComposite: s.creditComposite,
        creditRating: s.creditRating,
        marginDiagnostic: s.marginDiagnostic,
        ...(dividendIncomeReceivedByCorpId?.get(s.corpId.toString())
          ? { dividendIncomeReceived: dividendIncomeReceivedByCorpId.get(s.corpId.toString()) }
          : {}),
        createdAt: now,
      };
    });
    await db.collection("corporationHistory").insertMany(corpHistoryDocs);

    for (const s of corpSnapshots) {
      const prev = prevRatingByCorp.get(s.corpId.toString());
      if (prev == null || prev === s.creditRating) continue;
      const c = corpById.get(s.corpId.toString());
      if (!c) continue;
      void logWireEvent(
        "corp_credit_rating",
        wireHeadlineCorpCreditRating(c.name, prev, s.creditRating),
        { href: `/corporation/${c.sequentialId ?? c._id}` }
      );
      void createNotifications([
        {
          userId: c.userId,
          type: "corp_credit_rating_change",
          title: "Credit rating changed",
          message: `${c.name}: ${prev} → ${s.creditRating}`,
          metadata: {
            corporationId: s.corpId.toString(),
            priorRating: prev,
            newRating: s.creditRating,
          },
        },
      ]);
    }
  }
}
