"use client";

import { useState, type ReactNode } from "react";
import { flushSync } from "react-dom";
import {
  MONEY_PERIODS,
  MONEY_PERIOD_LABEL,
  MONEY_PERIOD_PER_LABEL,
  MONEY_PERIOD_SUFFIX,
  scaleMoney,
  unscaleMoney,
  type MoneyPeriod,
} from "@/lib/constants/moneyTimescale";
import {
  calcLogisticsGrowth,
  calcMarketingGrowth,
  calcRdGrowth,
  CEO_SALARY_MAX_REVENUE_MULTIPLE,
  CORP_OVERHEAD_MAX_REVENUE_MULTIPLE,
  getSprawlModifier,
  LOGISTICS_DECAY_RATE,
  LOGISTICS_MAX_SPRAWL_EFFECT,
  MARKETING_DIMINISHING_THRESHOLD,
  RD_DECAY_RATE,
  RD_DIMINISHING_THRESHOLD,
  RD_INNOVATION_INTERVAL,
  RD_INNOVATION_SCORE_THRESHOLD,
  SPRAWL_SECTOR_THRESHOLD,
} from "@/lib/constants/corporations";
import { CURRENCY_SYMBOLS, type CurrencyCode } from "@/lib/constants/currencies";
import type { CorporationDetail, Financials } from "../CorporationPageTypes";
import { DenseSection, Segmented, SmallButton, signTone, useCorpMoney } from "../dense/DenseKit";

/**
 * Whole-number amounts typed digit by digit can pass Number's safe range (a
 * 279-digit string becomes 1e+278, ticket #1237). Parse through BigInt and
 * clamp so a budget is always an integer the server can store.
 */
export function parseDisplayDigits(text: string): number {
  const cleaned = text.replace(/\D/g, "");
  if (cleaned === "") return 0;
  try {
    const big = BigInt(cleaned);
    if (big <= BigInt(0)) return 0;
    const max = BigInt(Number.MAX_SAFE_INTEGER);
    return Number(big > max ? max : big);
  } catch {
    return 0;
  }
}

type BudgetKey = "marketing" | "logistics" | "rd" | "ceo";

interface CeoBudgetPanelProps {
  corporation: CorporationDetail;
  financials: Financials;
  /** Sectors operated; drives the sprawl readout on the logistics line. */
  sectorCount: number;
  editMarketingBudget: string;
  setEditMarketingBudget: (val: string) => void;
  editLogisticsBudget: string;
  setEditLogisticsBudget: (val: string) => void;
  editRdBudget: string;
  setEditRdBudget: (val: string) => void;
  editCeoSalary: number;
  setEditCeoSalary: (val: number) => void;
  saving: boolean;
  onSaveSettings: () => void;
}

const PERIOD_OPTIONS = MONEY_PERIODS.map((p) => ({ value: p, label: MONEY_PERIOD_LABEL[p] }));

/** Statement line: label, amount, share of revenue, and a note column. */
function Line({
  label,
  amount,
  pct,
  note,
  strong,
  indent,
  amountClass = "text-foreground",
  title,
}: {
  label: ReactNode;
  amount: ReactNode;
  pct?: string | null;
  note?: ReactNode;
  strong?: boolean;
  indent?: boolean;
  amountClass?: string;
  title?: string;
}) {
  return (
    <tr className={strong ? "font-semibold" : undefined} title={title}>
      <td
        className={`border-b border-card-border/60 py-1.5 pr-2 text-[13px] ${
          indent ? "pl-4 text-muted" : "text-foreground"
        }`}
      >
        {label}
      </td>
      <td
        className={`whitespace-nowrap border-b border-card-border/60 px-2 py-1.5 text-right font-mono text-[13px] tabular-nums ${amountClass}`}
      >
        {amount}
      </td>
      <td className="hidden whitespace-nowrap border-b border-card-border/60 px-2 py-1.5 text-right font-mono text-xs tabular-nums text-muted sm:table-cell">
        {pct ?? ""}
      </td>
      <td className="hidden border-b border-card-border/60 py-1.5 pl-2 text-xs text-muted md:table-cell">
        {note}
      </td>
    </tr>
  );
}

function GroupHeader({ children }: { children: ReactNode }) {
  return (
    <tr>
      <td colSpan={4} className="pb-1 pt-3 text-xs font-medium text-muted">
        {children}
      </td>
    </tr>
  );
}

/**
 * The CEO's income statement with the operating budgets edited in place.
 *
 * Every budget is a row of the statement it changes, beside its share of
 * revenue and what it buys per turn, so a CEO sees the cost and the effect on
 * the same line. Budgets are stored as daily rates in the corp's currency; the
 * period toggle only rescales what is displayed and typed.
 */
export default function CeoBudgetPanel({
  corporation,
  financials,
  sectorCount,
  editMarketingBudget,
  setEditMarketingBudget,
  editLogisticsBudget,
  setEditLogisticsBudget,
  editRdBudget,
  setEditRdBudget,
  editCeoSalary,
  setEditCeoSalary,
  saving,
  onSaveSettings,
}: CeoBudgetPanelProps) {
  const [periodView, setPeriodView] = useState<MoneyPeriod>("turn");
  const [drafts, setDrafts] = useState<Partial<Record<BudgetKey, string>>>({});
  const money = useCorpMoney(corporation.liquidCurrencyCode);
  const code = (corporation.liquidCurrencyCode as CurrencyCode | undefined) ?? undefined;
  const symbol = code ? (CURRENCY_SYMBOLS[code] ?? "$") : "₳";
  const suffix = MONEY_PERIOD_SUFFIX[periodView];
  const scale = (daily: number) => Math.round(scaleMoney(daily, periodView));
  const revenue = financials.totalRevenue;
  const pctOfRevenue = (daily: number) =>
    revenue > 0 ? `${((daily / revenue) * 100).toFixed(1)}%` : null;
  const cost = (daily: number) =>
    daily === 0
      ? money.fmt(0)
      : daily < 0
        ? money.fmt(-scale(daily))
        : `(${money.fmt(scale(daily))})`;

  const daily: Record<BudgetKey, number> = {
    marketing: Math.max(0, Number(editMarketingBudget) || 0),
    logistics: Math.max(0, Number(editLogisticsBudget) || 0),
    rd: Math.max(0, Number(editRdBudget) || 0),
    ceo: editCeoSalary,
  };
  const stored: Record<BudgetKey, number> = {
    marketing: corporation.marketingBudget ?? 0,
    logistics: corporation.logisticsBudget ?? 0,
    rd: corporation.rdBudget ?? 0,
    ceo: corporation.ceoSalary ?? 0,
  };
  const dirty = (Object.keys(daily) as BudgetKey[]).some((k) => daily[k] !== stored[k]);

  // Overhead cap: marketing + logistics + R&D + CEO salary may not pass 150% of
  // daily revenue. Zero revenue makes the ceiling 0 (ticket #1237). A save that
  // lowers total overhead stays allowed so leftover budgets can be cleared.
  const combined = daily.marketing + daily.logistics + daily.rd + daily.ceo;
  const storedCombined = stored.marketing + stored.logistics + stored.rd + stored.ceo;
  const maxOverhead = Math.max(0, revenue) * CORP_OVERHEAD_MAX_REVENUE_MULTIPLE;
  const isOverCap = combined > maxOverhead && combined > storedCombined;
  // CEO salary alone is capped at 1.25x revenue (server rule, bug #0728).
  const maxCeoSalary = Math.floor(Math.max(0, revenue) * CEO_SALARY_MAX_REVENUE_MULTIPLE);
  const overheadPct = revenue > 0 ? (combined / revenue) * 100 : 0;

  // What each budget buys this turn, from the same formulas the turn runs.
  const anchor = (local: number) => money.toAnchor(local);
  const currentMs = corporation.marketingStrength ?? 0;
  const msGain = calcMarketingGrowth(anchor(daily.marketing), currentMs);
  const currentLs = corporation.logisticsStrength ?? 0;
  const lsNet = calcLogisticsGrowth(anchor(daily.logistics)) - currentLs * LOGISTICS_DECAY_RATE;
  const lsEquilibrium =
    daily.logistics > 0 ? calcLogisticsGrowth(anchor(daily.logistics)) / LOGISTICS_DECAY_RATE : 0;
  const currentRd = corporation.rdScore ?? 0;
  const rdNet = calcRdGrowth(anchor(daily.rd), currentRd) - currentRd * RD_DECAY_RATE;
  const sprawlCap =
    SPRAWL_SECTOR_THRESHOLD +
    SPRAWL_SECTOR_THRESHOLD * (Math.max(0, currentLs) / LOGISTICS_MAX_SPRAWL_EFFECT);
  const sprawlPenalty = getSprawlModifier(
    sectorCount,
    currentLs,
    Boolean(corporation.secondaryType)
  );
  const innovationPct = Math.min(1, Math.max(0, currentRd) / RD_INNOVATION_SCORE_THRESHOLD) * 100;

  const setters: Record<BudgetKey, (displayValue: number) => void> = {
    marketing: (v) => setEditMarketingBudget(String(Math.round(unscaleMoney(v, periodView)))),
    logistics: (v) => setEditLogisticsBudget(String(Math.round(unscaleMoney(v, periodView)))),
    rd: (v) => setEditRdBudget(String(Math.round(unscaleMoney(v, periodView)))),
    ceo: (v) => setEditCeoSalary(Math.min(Math.round(unscaleMoney(v, periodView)), maxCeoSalary)),
  };

  function commit(key: BudgetKey) {
    const draft = drafts[key];
    if (draft === undefined) return;
    setters[key](parseDisplayDigits(draft));
    setDrafts((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
  }

  function commitAll() {
    for (const key of Object.keys(drafts) as BudgetKey[]) commit(key);
  }

  function reset() {
    setDrafts({});
    setEditMarketingBudget(String(stored.marketing));
    setEditLogisticsBudget(String(stored.logistics));
    setEditRdBudget(String(stored.rd));
    setEditCeoSalary(stored.ceo);
  }

  function budgetInput(key: BudgetKey, label: string) {
    const display = String(scale(daily[key]));
    const changed = daily[key] !== stored[key];
    return (
      <span className="inline-flex items-center gap-1">
        <span className="text-xs text-muted">{symbol}</span>
        <input
          type="text"
          inputMode="numeric"
          aria-label={`${label} budget ${suffix}`}
          placeholder="0"
          value={drafts[key] ?? display}
          onFocus={() => setDrafts((prev) => ({ ...prev, [key]: display }))}
          onChange={(e) => setDrafts((prev) => ({ ...prev, [key]: e.target.value }))}
          onBlur={() => commit(key)}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
            if (e.key === "Escape") {
              setDrafts((prev) => {
                const next = { ...prev };
                delete next[key];
                return next;
              });
            }
          }}
          className={`h-7 w-32 rounded-md border bg-background px-2 text-right text-[13px] tabular-nums text-foreground focus:border-foreground focus:outline-none ${
            changed ? "border-foreground/70" : "border-card-border"
          }`}
        />
      </span>
    );
  }

  const grossProfit =
    revenue - financials.maintenanceCosts - financials.laborCosts - financials.growthCosts;
  const tax = financials.federalTax + financials.stateTax;

  return (
    <DenseSection
      id="ceo-budget"
      title="Budget and income"
      meta={MONEY_PERIOD_PER_LABEL[periodView]}
      actions={
        <Segmented
          ariaLabel="Budget period"
          options={PERIOD_OPTIONS}
          value={periodView}
          onChange={(p) => {
            setDrafts({});
            setPeriodView(p);
          }}
        />
      }
    >
      <table className="w-full border-collapse">
        <thead className="sr-only">
          <tr>
            <th>Line</th>
            <th>Amount</th>
            <th>Share of revenue</th>
            <th>Effect</th>
          </tr>
        </thead>
        <tbody>
          <Line
            label="Gross revenue"
            amount={money.fmt(scale(revenue))}
            pct={revenue > 0 ? "100%" : null}
            strong
          />
          <Line
            indent
            label="Sector maintenance"
            amount={cost(financials.maintenanceCosts)}
            amountClass={financials.maintenanceCosts < 0 ? "text-success" : "text-foreground"}
            pct={pctOfRevenue(financials.maintenanceCosts)}
          />
          {financials.laborCosts > 0 && (
            <Line
              indent
              label="Wages"
              amount={cost(financials.laborCosts)}
              pct={pctOfRevenue(financials.laborCosts)}
            />
          )}
          {financials.growthCosts > 0 && (
            <Line
              indent
              label="Growth investment"
              amount={cost(financials.growthCosts)}
              pct={pctOfRevenue(financials.growthCosts)}
            />
          )}
          <Line
            label="Gross profit"
            amount={money.fmtSigned(scale(grossProfit))}
            amountClass={signTone(grossProfit)}
            pct={pctOfRevenue(grossProfit)}
            strong
          />

          <GroupHeader>
            Operating budgets{dirty ? <span className="ml-2 text-foreground">unsaved</span> : null}
          </GroupHeader>
          <Line
            indent
            label="Marketing"
            amount={budgetInput("marketing", "Marketing")}
            pct={pctOfRevenue(daily.marketing)}
            note={
              daily.marketing > 0
                ? `+${msGain.toFixed(3)} strength/turn (now ${Math.round(currentMs)}, diminishing above ${MARKETING_DIMINISHING_THRESHOLD})`
                : `Strength ${Math.round(currentMs)}, no spend`
            }
          />
          <Line
            indent
            label="Logistics and operations"
            amount={budgetInput("logistics", "Logistics")}
            pct={pctOfRevenue(daily.logistics)}
            note={
              <>
                {daily.logistics > 0 ? (
                  <>
                    {lsNet >= 0 ? "+" : ""}
                    {lsNet.toFixed(2)}/turn, settles near {Math.round(lsEquilibrium)}
                  </>
                ) : currentLs > 0 ? (
                  <span className="text-warning">
                    Decaying {(currentLs * LOGISTICS_DECAY_RATE).toFixed(2)}/turn
                  </span>
                ) : (
                  "No spend"
                )}
                {". "}
                <span className={sectorCount > sprawlCap ? "text-warning" : undefined}>
                  {sectorCount} of {Math.floor(sprawlCap)} sectors before sprawl
                  {sectorCount > sprawlCap ? `, margin penalty ${sprawlPenalty.toFixed(1)}%` : ""}
                </span>
              </>
            }
          />
          <Line
            indent
            label="R&D"
            amount={budgetInput("rd", "R&D")}
            pct={pctOfRevenue(daily.rd)}
            note={
              daily.rd > 0 ? (
                `${rdNet >= 0 ? "+" : ""}${rdNet.toFixed(2)}/turn (now ${Math.round(currentRd)}). Innovation ${innovationPct.toFixed(0)}% every ${RD_INNOVATION_INTERVAL} turns; diminishing above ${RD_DIMINISHING_THRESHOLD}`
              ) : currentRd > 0 ? (
                <span className="text-warning">
                  Decaying {(currentRd * RD_DECAY_RATE).toFixed(2)}/turn
                </span>
              ) : (
                "No spend"
              )
            }
          />
          <Line
            indent
            label="CEO salary"
            amount={budgetInput("ceo", "CEO salary")}
            pct={pctOfRevenue(daily.ceo)}
            note={`Capped at 1.25x revenue (${money.fmt(scale(maxCeoSalary))}${suffix})`}
          />
          <Line
            indent
            label="Total overhead"
            amount={
              <span className={isOverCap ? "text-error" : undefined}>
                ({money.fmt(scale(combined))})
              </span>
            }
            pct={revenue > 0 ? `${overheadPct.toFixed(1)}%` : null}
            note={
              <span className={isOverCap ? "text-error" : undefined}>
                Cap 150% of revenue, {money.fmt(scale(maxOverhead))}
                {suffix}
                {isOverCap
                  ? revenue > 0
                    ? ". Lower a budget to save."
                    : ". No revenue, so no positive budgets."
                  : ""}
              </span>
            }
          />
          {dirty && (
            <Line
              indent
              label="Change from edits"
              amount={money.fmtSigned(scale(storedCombined - combined))}
              amountClass={signTone(storedCombined - combined)}
              note="To operating income once saved, before tax."
            />
          )}
          <tr>
            <td colSpan={4} className="border-b border-card-border/60 py-2">
              <div className="flex flex-wrap items-center justify-end gap-2">
                <SmallButton
                  onClick={reset}
                  disabled={saving || (!dirty && Object.keys(drafts).length === 0)}
                >
                  Reset
                </SmallButton>
                <SmallButton
                  tone="primary"
                  disabled={saving || isOverCap}
                  onClick={() => {
                    flushSync(() => commitAll());
                    onSaveSettings();
                  }}
                >
                  {saving ? "Saving" : "Save budgets"}
                </SmallButton>
              </div>
            </td>
          </tr>

          {financials.regulatoryBurden > 0 && (
            <Line
              indent
              label="Regulatory compliance"
              amount={cost(financials.regulatoryBurden)}
              pct={pctOfRevenue(financials.regulatoryBurden)}
            />
          )}
          {financials.pensionContributionCost > 0 && (
            <Line
              indent
              label="Pension contributions"
              amount={cost(financials.pensionContributionCost)}
              pct={pctOfRevenue(financials.pensionContributionCost)}
            />
          )}
          {financials.pensionTopUpCost > 0 && (
            <Line
              indent
              label="Pension deficit top-up"
              amount={cost(financials.pensionTopUpCost)}
              pct={pctOfRevenue(financials.pensionTopUpCost)}
            />
          )}
          <Line
            label="Operating income"
            amount={money.fmtSigned(scale(financials.operatingIncome))}
            amountClass={signTone(financials.operatingIncome)}
            pct={pctOfRevenue(financials.operatingIncome)}
            strong
            title="Earnings before interest and tax, at the saved budgets."
          />
          {tax > 0 && (
            <Line indent label="Corporate tax" amount={cost(tax)} pct={pctOfRevenue(tax)} />
          )}
          {financials.bondInterestCost > 0 && (
            <Line indent label="Bond interest" amount={cost(financials.bondInterestCost)} />
          )}
          {financials.governmentBondSubsidy > 0 && (
            <Line
              indent
              label="Government bond subsidy"
              amount={money.fmt(scale(financials.governmentBondSubsidy))}
            />
          )}
          {financials.imfFacilityPaymentDaily > 0 && (
            <Line
              indent
              label="IMF facility payment"
              amount={cost(financials.imfFacilityPaymentDaily)}
            />
          )}
          {financials.bondCouponIncome > 0 && (
            <Line
              indent
              label="Bond coupon income"
              amount={money.fmt(scale(financials.bondCouponIncome))}
            />
          )}
          {financials.imfFacilityReceiptsDaily > 0 && (
            <Line
              indent
              label="IMF facility receipts"
              amount={money.fmt(scale(financials.imfFacilityReceiptsDaily))}
            />
          )}
          {financials.dividendIncomeReceived > 0 && (
            <Line
              indent
              label="Dividend income"
              amount={money.fmt(scale(financials.dividendIncomeReceived))}
            />
          )}
          <Line
            label="Net income"
            amount={money.fmtSigned(scale(financials.income))}
            amountClass={signTone(financials.income)}
            pct={pctOfRevenue(financials.income)}
            strong
            title="Projected from the saved budgets and current rates."
          />
        </tbody>
      </table>
    </DenseSection>
  );
}
