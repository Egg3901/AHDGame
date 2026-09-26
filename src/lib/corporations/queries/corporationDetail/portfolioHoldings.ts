import { ObjectId, type Db } from "mongodb";
import type { Bond, Corporation, Shareholder } from "@/lib/db/types";
import { COUNTRY_CURRENCY_MAP } from "@/lib/constants/currencies";
import type { CurrencyCode } from "@/lib/constants/currencies";
import { perTurnCouponPayment } from "@/lib/constants/bonds";
import { getBondIssuerDisplayName } from "@/lib/bonds/sovereign";
import { BOND_UNIT_FACE_VALUE } from "@/lib/db/types/bond";
import {
  corpCapitalToAnchor,
  corpLiquidCapitalToAnchor,
  fxRateForCorpFromMap,
  loadValuationFxRates,
} from "@/lib/currency/corporationCapital";
import { TURNS_PER_DAY } from "@/lib/constants/corporations";
import { TURNS_PER_YEAR } from "@/lib/constants/turnTime";
import { getPublicShareQuote } from "@/lib/corporations/marketQuote";
import {
  findImfFacilityReceivablesForLender,
  type ImfFacilityReceivableRow,
} from "@/lib/corporations/imfPortfolioReceivables";
import {
  anchorPerTurnToFinancialDaily,
  imfFacilityPaymentAnchorPerTurn,
  sumImfLenderReceiptsAnchorPerTurnForReceivables,
} from "@/lib/imf/imfFacilityFinancials";
import { lastTurnSupplyAgreementCash } from "@/lib/corporations/supplyAgreementCash";
import type { SupplyAgreement } from "@/lib/db/types/supplyAgreement";

export interface LatestCorpIncomeRow {
  income?: number;
  turn?: number;
  dividendIncomeReceived?: number;
  perTurnBondCouponIncome?: number;
  perTurnBondDragOnNetIncome?: number;
  dividendPaidPerTurn?: number;
}

export interface HeldBondSummary {
  bondId: string;
  issuerName: string;
  currencyCode: CurrencyCode | undefined;
  units: number;
  couponRate: number;
  marketPrice: number;
  turnsRemaining: number;
  currentValue: number;
  currentValueAnchor: number;
  dailyIncome: number;
  dailyIncomeAnchor: number;
}

export type ImfReceivableView = ImfFacilityReceivableRow;

export interface PortfolioHoldings {
  outstandingBonds: Bond[];
  heldBondsSummary: HeldBondSummary[];
  totalBondHoldingsValue: number;
  dailyCouponIncome: number;
  totalStockHoldingsValue: number;
  imfReceivableRows: ImfReceivableView[];
  imfReceivablesPrincipal: number;
  imfLenderReceiptsAnchor: number;
  latestCorpIncomeRow: LatestCorpIncomeRow | null;
  turnIncomeForImf: number;
  dividendIncomeReceivedDaily: number;
  imfFacilityPaymentDaily: number;
  imfFacilityReceiptsDaily: number;
  totalDebtAnchor: number;
  annualInterestAnchor: number;
  dailyInterestAnchor: number;
  supplyAgreementSettlementDaily: number;
  supplyAgreementUnpaidAnchor: number;
}

/**
 * Bonds, portfolio holdings, and corp-income reads for the detail view (#587).
 *
 * Held-bond values and held-corp stock values are anchor-denominated through
 * the valuation FX map (displayed and ranked values); the corp's own
 * outstanding-debt anchors use the page FX map. Both maps are preserved
 * exactly as the inline code resolved them.
 */
export async function loadPortfolioHoldings(
  db: Db,
  corporation: Corporation,
  currentTurn: number,
  fxByCurrency: Map<CurrencyCode, number>
): Promise<PortfolioHoldings> {
  const [outstandingBonds, heldBondsRaw] = await Promise.all([
    db.collection<Bond>("bonds").find({ corporationId: corporation._id, matured: false }).toArray(),
    db
      .collection<Bond>("bonds")
      .find({ "holders.corporationId": corporation._id, matured: false })
      .toArray(),
  ]);

  const heldBondIssuerCorpIds = [
    ...new Set(heldBondsRaw.filter((b) => b.corporationId).map((b) => b.corporationId.toString())),
  ];
  const heldBondIssuerCorps =
    heldBondIssuerCorpIds.length > 0
      ? await db
          .collection<Corporation>("corporations")
          .find(
            { _id: { $in: heldBondIssuerCorpIds.map((id) => new ObjectId(id)) } },
            { projection: { _id: 1, name: 1 } }
          )
          .toArray()
      : [];
  const heldBondIssuerMap = new Map(heldBondIssuerCorps.map((c) => [c._id.toString(), c.name]));

  const GAME_DAYS_PER_YEAR_RATIO = TURNS_PER_YEAR / TURNS_PER_DAY;
  const portfolioFxByCurrency = await loadValuationFxRates(db);
  const heldBondsSummary: HeldBondSummary[] = heldBondsRaw.map((bond) => {
    // `holders` is required by the Bond type, but legacy rows can arrive
    // without it; an unguarded `.find` throws a TypeError and 500s the whole
    // corporation page (#2349). A bond with no holder rows contributes nothing.
    const holding = (bond.holders ?? []).find(
      (h) => h.corporationId?.toString() === corporation._id.toString()
    );
    const units = holding?.units ?? 0;
    const couponPerUnit = perTurnCouponPayment(bond.couponRate, BOND_UNIT_FACE_VALUE);
    const dailyIncome = couponPerUnit * units * TURNS_PER_DAY;
    const currentValue = units * BOND_UNIT_FACE_VALUE * bond.marketPrice;
    const bondCcy = (bond.currencyCode ??
      (bond.countryId && bond.countryId in COUNTRY_CURRENCY_MAP
        ? COUNTRY_CURRENCY_MAP[bond.countryId as keyof typeof COUNTRY_CURRENCY_MAP]
        : undefined)) as CurrencyCode | undefined;
    const bondRate = bondCcy ? (portfolioFxByCurrency.get(bondCcy) ?? 1) : 1;
    const currentValueAnchor = bondCcy && bondRate > 0 ? currentValue / bondRate : currentValue;
    const dailyIncomeAnchor = bondCcy && bondRate > 0 ? dailyIncome / bondRate : dailyIncome;
    const issuerName = getBondIssuerDisplayName(
      bond,
      heldBondIssuerMap.get(bond.corporationId?.toString() ?? "")
    );

    return {
      bondId: bond._id.toString(),
      issuerName,
      currencyCode: bondCcy,
      units,
      couponRate: bond.couponRate,
      marketPrice: bond.marketPrice,
      turnsRemaining: Math.max(0, bond.maturityTurn - currentTurn),
      currentValue: Math.round(currentValue),
      currentValueAnchor,
      dailyIncome: Math.round(dailyIncome),
      dailyIncomeAnchor,
    };
  });

  const totalBondHoldingsValue = heldBondsSummary.reduce((sum, b) => sum + b.currentValueAnchor, 0);
  const dailyCouponIncome = heldBondsSummary.reduce((sum, b) => sum + b.dailyIncomeAnchor, 0);

  const heldCorps = await db
    .collection<Corporation>("corporations")
    .find({ "shareholders.corporationId": corporation._id })
    .project({ _id: 1, sharePrice: 1, shareholders: 1, countryId: 1 })
    .toArray();

  let totalStockHoldingsValue = 0;
  for (const heldCorp of heldCorps) {
    const entry = heldCorp.shareholders?.find(
      (sh: Shareholder) => sh.corporationId?.toString() === corporation._id.toString()
    );
    if (entry && entry.shares > 0) {
      const sharePrice = getPublicShareQuote(heldCorp);
      const stockValueLocal = entry.shares * sharePrice;
      const heldFxRate = fxRateForCorpFromMap(heldCorp, portfolioFxByCurrency);
      totalStockHoldingsValue += corpLiquidCapitalToAnchor(stockValueLocal, heldCorp, heldFxRate);
    }
  }

  const { receivables: imfReceivableRows, totalPrincipal: imfReceivablesPrincipal } =
    await findImfFacilityReceivablesForLender(db, corporation._id);
  const [latestCorpIncomeRow, imfLenderReceiptsAnchor] = await Promise.all([
    db.collection<LatestCorpIncomeRow>("corporationHistory").findOne(
      { corporationId: corporation._id },
      {
        sort: { turn: -1 },
        projection: {
          income: 1,
          turn: 1,
          dividendIncomeReceived: 1,
          perTurnBondCouponIncome: 1,
          perTurnBondDragOnNetIncome: 1,
          dividendPaidPerTurn: 1,
        },
      }
    ),
    imfReceivableRows.length > 0
      ? sumImfLenderReceiptsAnchorPerTurnForReceivables(db, imfReceivableRows)
      : Promise.resolve(0),
  ]);
  const turnIncomeForImf =
    typeof latestCorpIncomeRow?.income === "number" ? latestCorpIncomeRow.income : 0;
  // Realized dividend income (local ccy) this corp received from holdings last
  // turn, scaled per-turn → daily to match the projected `income` units (#3109).
  // Reporting only — the cash was already credited in the dividend phase.
  const dividendIncomeReceivedDaily =
    typeof latestCorpIncomeRow?.dividendIncomeReceived === "number"
      ? Math.round(latestCorpIncomeRow.dividendIncomeReceived * TURNS_PER_DAY)
      : 0;
  const imfFacilityPaymentDaily =
    corporation.imfBailoutActive === true
      ? Math.round(
          anchorPerTurnToFinancialDaily(
            imfFacilityPaymentAnchorPerTurn(corporation, turnIncomeForImf)
          )
        )
      : 0;
  const imfFacilityReceiptsDaily =
    imfReceivableRows.length > 0
      ? Math.round(anchorPerTurnToFinancialDaily(imfLenderReceiptsAnchor))
      : 0;

  const supplySettlementTurn = latestCorpIncomeRow?.turn ?? currentTurn;
  const supplyAgreementDocs = await db
    .collection<SupplyAgreement>("supplyAgreements")
    .find(
      {
        $or: [{ supplierCorpId: corporation._id }, { buyerCorpId: corporation._id }],
        lastDeliveryTurn: supplySettlementTurn,
      },
      {
        projection: {
          supplierCorpId: 1,
          buyerCorpId: 1,
          lastDeliveryTurn: 1,
          lastSupplierCashDelta: 1,
          lastBuyerCashDelta: 1,
          lastUnpaidSettlementAnchor: 1,
        },
      }
    )
    .toArray();
  const supplyAgreementCash = lastTurnSupplyAgreementCash({
    corpId: corporation._id.toString(),
    turn: supplySettlementTurn,
    agreements: supplyAgreementDocs,
  });
  const supplyAgreementSettlementDaily = Math.round(supplyAgreementCash.netLocal * TURNS_PER_DAY);
  const supplyAgreementUnpaidAnchor = Math.round(supplyAgreementCash.unpaidAnchor);

  const totalDebtAnchor = outstandingBonds.reduce((sum, b) => {
    const bondCcy = (b.currencyCode ??
      (b.countryId && b.countryId in COUNTRY_CURRENCY_MAP
        ? COUNTRY_CURRENCY_MAP[b.countryId as keyof typeof COUNTRY_CURRENCY_MAP]
        : undefined)) as CurrencyCode | undefined;
    const bondFxRate = bondCcy ? (fxByCurrency.get(bondCcy) ?? 1) : 1;
    return sum + corpCapitalToAnchor(b.totalIssued, bondCcy, bondFxRate);
  }, 0);
  const annualInterestAnchor = outstandingBonds.reduce((sum, b) => {
    const bondCcy = (b.currencyCode ??
      (b.countryId && b.countryId in COUNTRY_CURRENCY_MAP
        ? COUNTRY_CURRENCY_MAP[b.countryId as keyof typeof COUNTRY_CURRENCY_MAP]
        : undefined)) as CurrencyCode | undefined;
    const bondFxRate = bondCcy ? (fxByCurrency.get(bondCcy) ?? 1) : 1;
    return sum + corpCapitalToAnchor((b.couponRate / 100) * b.totalIssued, bondCcy, bondFxRate);
  }, 0);
  const dailyInterestAnchor = annualInterestAnchor / GAME_DAYS_PER_YEAR_RATIO;

  return {
    outstandingBonds,
    heldBondsSummary,
    totalBondHoldingsValue,
    dailyCouponIncome,
    totalStockHoldingsValue,
    imfReceivableRows,
    imfReceivablesPrincipal,
    imfLenderReceiptsAnchor,
    latestCorpIncomeRow,
    turnIncomeForImf,
    dividendIncomeReceivedDaily,
    imfFacilityPaymentDaily,
    imfFacilityReceiptsDaily,
    totalDebtAnchor,
    annualInterestAnchor,
    dailyInterestAnchor,
    supplyAgreementSettlementDaily,
    supplyAgreementUnpaidAnchor,
  };
}
