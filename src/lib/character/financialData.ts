import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import type { Corporation, CorporateSector, Bond } from "@/lib/db/types";
import { BOND_UNIT_FACE_VALUE } from "@/lib/db/types/bond";
import { perTurnCouponPayment } from "@/lib/constants/bonds";
import {
  estimateCorpDividendPaidLastTurn,
  fetchLatestCorpHistoryDividendRows,
} from "@/lib/corporation/dividendIncomeFromHistory";
import {
  corpCapitalToAnchor,
  corpLiquidCapitalToAnchor,
  loadValuationFxRates,
  fxRateForCorpFromMap,
} from "@/lib/currency/corporationCapital";
import { getPublicShareQuote } from "@/lib/corporations/marketQuote";
import { COUNTRY_CURRENCY_MAP } from "@/lib/constants/currencies";
import type { CurrencyCode } from "@/lib/constants/currencies";

export async function getFinancialData(characterId: ObjectId) {
  const db = await getDb();

  const [corporation, corporationsWithShares, activeBonds] = await Promise.all([
    db.collection<Corporation>("corporations").findOne({
      ceoId: characterId,
      ceoVacant: { $ne: true },
    }),
    db
      .collection<Corporation>("corporations")
      .find({ "shareholders.characterId": characterId })
      .project({
        _id: 1,
        sharePrice: 1,
        shareholders: 1,
        totalShares: 1,
        dividendRate: 1,
        liquidCurrencyCode: 1,
        countryId: 1,
      })
      .toArray(),
    db
      .collection<Bond>("bonds")
      .find({ matured: false, defaulted: false, "holders.characterId": characterId })
      .project({ couponRate: 1, currencyCode: 1, countryId: 1, holders: 1 })
      .toArray(),
  ]);

  const latestHistByCorp = await fetchLatestCorpHistoryDividendRows(
    db,
    corporationsWithShares.map((c) => c._id)
  );

  // Load FX rates before the corp loop so sharePrice can be anchor-normalized.
  // corp.sharePrice is stored in the corp's liquidCurrencyCode (post-v0.2.6 LOCAL);
  // raw multiplication without conversion produces wrong values for non-USD corps.
  // Valuation map, not the settlement map: this value is DISPLAYED and RANKED.
  // The settlement map leaves the six bloc currencies (PLZ/CSK/HUF/YUD/BGL/ROL,
  // 102 corps) missing on purpose, which converted them at 1.0. See
  // corporationCapital.ts.
  const fxByCurrencyProfile = await loadValuationFxRates(db);

  // EQUITIES ONLY, matching `investorRankingSnapshot.portfolioValue`. The wealth
  // list's same-named field is stocks PLUS bonds (see wealthListSnapshot.ts), so
  // the two are not comparable. Bonds surface here via `bondIncomePerTurn`.
  let portfolioValue = 0;
  let dividendIncomePerTurn = 0;
  for (const corp of corporationsWithShares) {
    const sh = (corp.shareholders as Array<{ characterId?: ObjectId; shares: number }>).find(
      (s) => s.characterId?.toString() === characterId.toString()
    );
    if (sh && sh.shares > 0) {
      const corpFxRate = fxRateForCorpFromMap(corp, fxByCurrencyProfile);
      portfolioValue += corpLiquidCapitalToAnchor(
        sh.shares * getPublicShareQuote(corp),
        corp,
        corpFxRate
      );

      if (corp.totalShares) {
        const hist = latestHistByCorp.get(corp._id.toString());
        if (hist) {
          const totalCorpDividendPaidLocal = estimateCorpDividendPaidLastTurn(hist);
          const totalCorpDividendPaidAnchor = corpCapitalToAnchor(
            totalCorpDividendPaidLocal,
            corp.liquidCurrencyCode,
            corpFxRate
          );
          dividendIncomePerTurn += totalCorpDividendPaidAnchor * (sh.shares / corp.totalShares);
        }
      }
    }
  }

  // Cross-bond `bondIncomePerTurn` for the FinancialStrip "Bond coupon income"
  // display. `perTurnCouponPayment × units` produces LOCAL in `bond.currencyCode`
  // (Task-18B); anchor-normalize per-bond before summing so a holder with bonds
  // in multiple currencies gets a coherent ₳ total (FinancialStrip passes this
  // to `formatFull`, which applies the viewer's wallet preference). (B7)
  let bondIncomePerTurn = 0;
  for (const bond of activeBonds) {
    const holder = bond.holders.find(
      (h: { characterId?: ObjectId; units: number }) =>
        h.characterId?.toString() === characterId.toString()
    );
    if (!holder || holder.units <= 0) continue;
    const bondCcy = (bond.currencyCode ??
      (bond.countryId && bond.countryId in COUNTRY_CURRENCY_MAP
        ? COUNTRY_CURRENCY_MAP[bond.countryId as keyof typeof COUNTRY_CURRENCY_MAP]
        : undefined)) as CurrencyCode | undefined;
    const bondFxRate = bondCcy ? (fxByCurrencyProfile.get(bondCcy) ?? 1) : 1;
    const couponLocal = perTurnCouponPayment(bond.couponRate, BOND_UNIT_FACE_VALUE) * holder.units;
    bondIncomePerTurn += corpCapitalToAnchor(couponLocal, bondCcy, bondFxRate);
  }

  let corporateSectorSummary: { sectorCount: number; totalRevenuePerTurn: number } | null = null;
  if (corporation) {
    const sectorAgg = await db
      .collection<CorporateSector>("corporateSectors")
      .aggregate<{ total: number; n: number }>([
        { $match: { corporationId: corporation._id } },
        { $group: { _id: null, total: { $sum: "$revenue" }, n: { $sum: 1 } } },
      ])
      .toArray();
    corporateSectorSummary = {
      sectorCount: sectorAgg[0]?.n ?? 0,
      totalRevenuePerTurn: Math.round(sectorAgg[0]?.total ?? 0),
    };
  }

  const fxRatesRecord = Object.fromEntries(fxByCurrencyProfile) as Partial<
    Record<CurrencyCode, number>
  >;

  return {
    bondIncomePerTurn,
    dividendIncomePerTurn,
    portfolioValue,
    fxRatesRecord,
    corporation: corporation
      ? {
          sequentialId: corporation.sequentialId,
          name: corporation.name,
          type: corporation.type,
          liquidCapital: corporation.liquidCapital,
          liquidCurrencyCode: corporation.liquidCurrencyCode ?? null,
          headquartersState: corporation.headquartersState,
          ceoSalary: corporation.ceoSalary ?? 0,
        }
      : null,
    corporateSectorSummary,
  };
}
