import type { Financials } from "../CorporationPageTypes";
import { scaleMoney, type MoneyPeriod } from "@/lib/constants/moneyTimescale";

/** @deprecated Use `MoneyPeriod` — kept as an alias so existing imports resolve. */
export type Period = MoneyPeriod;

/** Period convention lives in `@/lib/constants/moneyTimescale` — see MONEY_PERIOD_FACTOR. */
export function scaleToPeriod(value: number, period: Period): number {
  return scaleMoney(value, period);
}

/**
 * Net margin = net income as a share of total income taken in.
 *
 * `income` is coupon-inclusive (it folds in bond coupon income and IMF facility
 * receipts), so dividing by operating revenue alone produces margins above 100%
 * for corps whose earnings are dominated by a bond portfolio (support #941 /
 * #942 showed 194% and 121%). Broaden the denominator to the same non-operating
 * inflows that feed net income so the ratio reads as "profit per dollar of total
 * income", which stays within a sane range and is what a reader expects.
 */
export function netMarginPct(
  f: Pick<Financials, "income" | "totalRevenue" | "bondCouponIncome" | "imfFacilityReceiptsDaily">
): number {
  const incomeBase =
    f.totalRevenue + Math.max(0, f.bondCouponIncome) + Math.max(0, f.imfFacilityReceiptsDaily);
  if (incomeBase <= 0) return 0;
  return (f.income / incomeBase) * 100;
}

/**
 * The single net-income basis every corporation surface must read from.
 *
 * Ticket #1098: the masthead and Overview showed a NEGATIVE income per turn for
 * a corp the Financials page reported as profitable. Two independent errors:
 *
 *  1. They subtracted `dividendDistribution` from `realizedIncome`. The engine
 *     books `income = afterTaxOperating − dividendPayout`, so the realized
 *     figure is ALREADY net of dividends — subtracting again double-counts.
 *  2. `dividendDistribution` is derived from the PROJECTED income, which can be
 *     several times the realized figure (the projection cannot reproduce
 *     embargo/tariff/clearing haircuts). Netting a projection-sized dividend off
 *     a realized-sized income flips the sign on a profitable corp.
 *
 * Symmetrically, the Financials headline added bond coupons + dividends received
 * on top of `realizedIncome`, which has folded both in since #941 — so it
 * overstated by the whole non-operating leg.
 *
 * `netIncome` is pre-dividend (the income-statement headline). `retained` is
 * what stays with the corp after the payout, which is what the masthead and
 * Overview report.
 */
export function corpIncomeBasis(
  f: Pick<Financials, "income" | "realizedIncome" | "realizedDividendPaid" | "dividendDistribution">
): { netIncome: number; retained: number; dividendPaid: number; isRealized: boolean } {
  if (typeof f.realizedIncome === "number") {
    const dividendPaid = Math.max(0, f.realizedDividendPaid ?? 0);
    return {
      netIncome: f.realizedIncome + dividendPaid,
      retained: f.realizedIncome,
      dividendPaid,
      isRealized: true,
    };
  }
  const dividendPaid = Math.max(0, f.dividendDistribution);
  return {
    netIncome: f.income,
    retained: f.income - dividendPaid,
    dividendPaid,
    isRealized: false,
  };
}

export type ValuationTone = "over" | "under" | "fair";

export function valuation(
  marketCap: number,
  bookValue: number
): { ratio: number; label: string; tone: ValuationTone } {
  const ratio = bookValue > 0 ? marketCap / bookValue : 0;
  if (ratio > 1.1) return { ratio, label: "Overvalued", tone: "over" };
  if (ratio > 0 && ratio < 0.9) return { ratio, label: "Undervalued", tone: "under" };
  return { ratio, label: "Fairly valued", tone: "fair" };
}

export type AllocTone =
  | "maintenance"
  | "growth"
  | "marketing"
  | "logistics"
  | "rd"
  | "salary"
  | "pension"
  | "tax"
  | "interest";

export interface AllocSegment {
  key: AllocTone;
  label: string;
  /** Magnitude, scaled to the selected period. */
  value: number;
  /** Share of gross revenue (%). 0 when revenue is non-positive. */
  pct: number;
  tone: AllocTone;
}

export function buildAllocation(
  f: Financials,
  period: Period
): { revenue: number; segments: AllocSegment[]; netIncome: number; netPct: number } {
  const revenue = scaleToPeriod(f.totalRevenue, period);
  const pctOf = (raw: number) => (f.totalRevenue > 0 ? (raw / f.totalRevenue) * 100 : 0);
  const seg = (key: AllocTone, label: string, raw: number): AllocSegment => ({
    key,
    label,
    value: scaleToPeriod(raw, period),
    pct: pctOf(raw),
    tone: key,
  });

  const tax = f.federalTax + f.stateTax;
  const netInterest = Math.max(
    0,
    f.bondInterestCost +
      f.imfFacilityPaymentDaily -
      f.bondCouponIncome -
      f.dividendIncomeReceived -
      f.governmentBondSubsidy -
      f.imfFacilityReceiptsDaily
  );

  const segments = [
    seg("maintenance", "Maintenance", f.maintenanceCosts),
    seg("growth", "Growth", f.growthCosts),
    seg("marketing", "Marketing", f.marketingCosts),
    seg("logistics", "Logistics", f.logisticsCosts),
    seg("rd", "R&D", f.rdCosts),
    seg("salary", "CEO salary", f.ceoSalaryCost),
    seg("pension", "Pensions", f.pensionContributionCost + f.pensionTopUpCost),
    seg("tax", "Taxes", tax),
    seg("interest", "Net interest", netInterest),
  ].filter((s) => s.value > 0);

  return {
    revenue,
    segments,
    netIncome: scaleToPeriod(f.income, period),
    netPct: f.totalRevenue > 0 ? (f.income / f.totalRevenue) * 100 : 0,
  };
}
