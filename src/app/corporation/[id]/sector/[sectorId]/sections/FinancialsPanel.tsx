"use client";

import {
  MAX_GROWTH_RATE,
  MIN_GROWTH_RATE,
  GROWTH_RATE_TURNS_PER_YEAR,
  GROWTH_COST_MULTIPLIER,
  TURNS_PER_DAY,
} from "@/lib/constants/corporations";
import { MONEY_PERIOD_HELP } from "@/lib/constants/moneyTimescale";
import { useCurrency } from "@/contexts/CurrencyContext";
import FinRow from "../components/FinRow";
import type { SectorData, Financials, Margins, CorporationRef } from "../types";
import type { CurrencyCode } from "@/lib/constants/currencies";

const GROWTH_STEP = 0.5;

interface FinancialsPanelProps {
  sector: SectorData;
  financials: Financials;
  margins: Margins;
  corporation: CorporationRef;
  isCeo: boolean;
  /** Capital market mode is on for this sector — growth is investment, not a revenue dial. */
  capitalEnabled?: boolean;
  growthUpdating: boolean;
  growthMessage?: string;
  onGrowthChange: (delta: number) => void;
}

export default function FinancialsPanel({
  sector,
  financials,
  margins,
  corporation,
  isCeo,
  capitalEnabled,
  growthUpdating,
  growthMessage,
  onGrowthChange,
}: FinancialsPanelProps) {
  const { formatAmount, toInternalFrom } = useCurrency();
  // Post-v0.2.6: sector.revenue / maintenance / growthCost / tax approximations
  // are stored in the corp's liquidCurrencyCode. Normalize to ₳ + pass code so
  // wallet-preference display still governs.
  const liquidCode = (corporation.liquidCurrencyCode as CurrencyCode | undefined) ?? undefined;
  const fmtMoney = (val: number) => {
    const anchor = liquidCode ? toInternalFrom(val, liquidCode) : val;
    return formatAmount(anchor, liquidCode);
  };
  const fmtMoneyFull = fmtMoney;
  // Figures are stored per financial day (TURNS_PER_DAY turns). Rows show the
  // per-turn amount as the primary value with the daily figure as secondary.
  const perTurn = (dailyAmount: number) => fmtMoneyFull(Math.round(dailyAmount / TURNS_PER_DAY));
  const perTurnParen = (dailyAmount: number) => `(${perTurn(dailyAmount)})`;
  const dailyParen = (dailyAmount: number) => `(${fmtMoney(dailyAmount)})`;

  // Realization gap, signed. Positive = earning above nameplate (price premium
  // or hot production policy); negative = capacity/clearing/throughput/embargo
  // haircut. Both directions have to be visible or the P&L does not add up.
  const realizationGap =
    financials.realizedRevenue != null && financials.revenue > 0
      ? financials.realizedRevenue / financials.revenue - 1
      : 0;
  const showRealized = financials.realizedRevenue != null && Math.abs(realizationGap) >= 0.005;

  return (
    <div className="rounded-xl border border-card-border bg-card p-6">
      <h2 className="mb-1 text-lg font-bold text-foreground">Sector Financials</h2>
      <p className="mb-4 text-xs text-muted">
        {MONEY_PERIOD_HELP} Figures below are per turn; each row&apos;s tooltip shows the daily
        amount.
      </p>
      <div className="space-y-3">
        <FinRow
          label="Revenue"
          value={perTurn(financials.revenue)}
          daily={fmtMoney(financials.revenue)}
          valueClass="text-success"
          tooltip="Headline income from this sector per turn, based on the market share you hold. Net Profit below uses the amount you actually earned, not this figure."
        />
        {/* Realized revenue. This used to render only when realization was
            UNFAVOURABLE (`realized < revenue * 0.995`), so a sector selling into
            a price premium (the realization factor reaches 1.5) hid the row
            entirely — and Net Profit then exceeded Revenue × margin with nothing
            on screen to account for it. Show the row whenever it differs in
            EITHER direction; only a gap too small to see stays hidden. */}
        {showRealized && (
          <FinRow
            label={
              financials.embargoSuspended
                ? "Realized (after embargo)"
                : realizationGap > 0
                  ? "Realized revenue (premium)"
                  : "Realized revenue"
            }
            value={perTurn(financials.realizedRevenue as number)}
            daily={fmtMoney(financials.realizedRevenue as number)}
            valueClass={
              financials.embargoSuspended
                ? "text-error"
                : realizationGap > 0
                  ? "text-success"
                  : "text-muted"
            }
            indent
            tooltip={
              financials.embargoSuspended
                ? "What you actually earned once a trade embargo blocked part of your output from selling. Net Profit uses this figure. The gap from the headline Revenue above is what the embargo cost you."
                : realizationGap > 0
                  ? "What you actually earned. It beats the headline figure because your goods are selling above the usual price, or your factories are running hard. Net Profit uses this figure, not the headline Revenue."
                  : "What you actually earned. It falls short of the headline figure because you could not make enough, could not sell it all, or your factories are not running at full tilt. Net Profit uses this figure."
            }
          />
        )}
        {showRealized && (
          <div className="flex items-center justify-between pl-8">
            <span className="text-xs text-muted">Earned vs headline</span>
            <span
              className={`text-xs font-medium tabular-nums ${realizationGap > 0 ? "text-success" : "text-error"}`}
            >
              {realizationGap > 0 ? "+" : ""}
              {(realizationGap * 100).toFixed(1)}%
            </span>
          </div>
        )}
        <FinRow
          label="Maintenance"
          value={perTurn(financials.maintenance)}
          daily={fmtMoney(financials.maintenance)}
          valueClass="text-error"
          indent
          tooltip={
            financials.laborCost > 0
              ? `Non-labour operating costs (upkeep, inputs, overhead). Labour is broken out as Wages below. Effective margin is ${margins.effective}%.`
              : `Operating costs: revenue × (1 - effective margin). Effective margin is ${margins.effective}%.`
          }
        />
        {financials.laborCost > 0 && (
          <FinRow
            label="Wages"
            value={perTurn(financials.laborCost)}
            daily={fmtMoney(financials.laborCost)}
            valueClass="text-error"
            indent
            tooltip="What this sector pays its workers. It moves with how many people you employ, local pay levels, and any union pay demand. It is split out of Maintenance, and the two together are the full running cost."
          />
        )}
        <FinRow
          label="Growth Cost"
          value={perTurn(financials.growthCost)}
          daily={fmtMoney(financials.growthCost)}
          valueClass="text-error"
          indent
          tooltip="Cost of the currently active growth rate (not the target). Scales with revenue and the active growth rate; rises gradually as the active rate trends toward your target."
        />
        {(financials.techGrowthCostReductionPct ?? 0) > 0 && (
          <div className="flex items-center justify-between pl-8">
            <span className="text-xs text-muted">Tech tree reduction</span>
            <span className="text-xs font-medium tabular-nums text-success">
              -{financials.techGrowthCostReductionPct}%
            </span>
          </div>
        )}
        <div className="border-t border-card-border pt-2">
          <FinRow
            label="Net Profit"
            value={perTurn(financials.profit)}
            daily={fmtMoney(financials.profit)}
            valueClass={financials.profit >= 0 ? "text-success" : "text-error"}
            bold
            tooltip={
              showRealized
                ? "What you actually earned (not the headline Revenue line at the top), minus maintenance, wages, and growth costs. Company-wide costs such as marketing and CEO salary come off before tax. See below."
                : "Revenue minus maintenance, wages, and growth costs. Company-wide costs such as marketing and CEO salary come off before tax. See below."
            }
          />
        </div>

        {financials.corpOverheadShare > 0 && (
          <div className="space-y-2">
            <FinRow
              label="Corp overhead (this sector's share)"
              value={perTurnParen(financials.corpOverheadShare)}
              daily={dailyParen(financials.corpOverheadShare)}
              valueClass="text-error"
              indent
              tooltip="This sector's slice of company-wide costs such as marketing, logistics, and CEO salary. Sectors that bring in more revenue carry more of them. It comes off Net Profit before tax."
            />
            <FinRow
              label="Taxable income"
              value={perTurn(financials.taxableIncome)}
              daily={fmtMoney(financials.taxableIncome)}
              valueClass={financials.taxableIncome > 0 ? "text-foreground" : "text-muted"}
              tooltip="Net Profit minus this sector's share of company-wide costs, and never below zero. The tax below is charged on this figure. If the shared costs are bigger than the profit, the sector pays no tax even though Net Profit looks positive."
            />
          </div>
        )}

        {(financials.federalTaxRate > 0 || financials.stateTaxRate > 0) && (
          <div className="border-t border-card-border pt-3 space-y-2">
            <div className="text-[11px] font-semibold text-muted uppercase tracking-wider">
              Corporate Tax (this sector&apos;s share)
            </div>
            {financials.federalTaxRate > 0 && (
              <FinRow
                label={`Federal (${financials.federalTaxRate}%)`}
                value={perTurnParen(financials.federalTaxApprox)}
                daily={dailyParen(financials.federalTaxApprox)}
                valueClass="text-error"
                indent
                tooltip={`This sector's federal tax at ${financials.federalTaxRate}%. It is charged on the sector's slice of company profit, after its share of company-wide costs such as marketing, logistics, and CEO salary. Sectors that bring in more revenue take a bigger slice of both. This matches the federal tax shown for this sector on the corporation Financials tab.`}
              />
            )}
            {financials.stateTaxRate > 0 && (
              <FinRow
                label={`State / Regional (${financials.stateTaxRate}%)`}
                value={perTurnParen(financials.stateTaxApprox)}
                daily={dailyParen(financials.stateTaxApprox)}
                valueClass="text-error"
                indent
                tooltip={`This sector's state or regional tax at ${financials.stateTaxRate}%, charged on the same slice of profit as the federal line above. Sectors in low-tax states pay less, no matter where the company is headquartered.`}
              />
            )}
          </div>
        )}
      </div>

      {/* CEO Growth Controls */}
      {isCeo && (
        <div className="mt-4 border-t border-card-border pt-4">
          <div className="flex items-center justify-between gap-4">
            <div className="min-w-0">
              <span className="text-sm font-medium text-foreground">Growth Target</span>
              <p className="mt-1 text-[11px] leading-snug text-muted">
                {capitalEnabled ? (
                  <>
                    Your investment rate. This budget builds new capacity, and if you stop
                    investing, what you have slowly wears out. The active rate trends toward this
                    target by 0.5pp per turn (1 game year = {GROWTH_RATE_TURNS_PER_YEAR} turns), so
                    capacity and its cost adjust gradually rather than snapping. See the Capital
                    panel below.
                  </>
                ) : (
                  <>
                    Revenue growth you want to maintain, per game year ({GROWTH_RATE_TURNS_PER_YEAR}{" "}
                    turns), not per day. The active rate trends toward this target by 0.5pp per
                    turn, so revenue and growth cost adjust gradually rather than snapping.
                  </>
                )}
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                onClick={() => onGrowthChange(-GROWTH_STEP)}
                disabled={growthUpdating || sector.targetGrowthRate <= MIN_GROWTH_RATE}
                className="flex h-8 w-8 items-center justify-center rounded-lg border border-card-border bg-background text-sm font-bold text-foreground transition-colors hover:bg-card-elevated disabled:cursor-not-allowed disabled:opacity-40"
                aria-label="Decrease growth target"
              >
                -
              </button>
              <span className="w-14 text-center text-sm font-bold tabular-nums text-primary">
                {sector.targetGrowthRate.toFixed(1)}%
              </span>
              <button
                onClick={() => onGrowthChange(GROWTH_STEP)}
                disabled={growthUpdating || sector.targetGrowthRate >= MAX_GROWTH_RATE}
                className="flex h-8 w-8 items-center justify-center rounded-lg border border-card-border bg-background text-sm font-bold text-foreground transition-colors hover:bg-card-elevated disabled:cursor-not-allowed disabled:opacity-40"
                aria-label="Increase growth target"
              >
                +
              </button>
            </div>
          </div>

          <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
            <div className="rounded-lg border border-card-border bg-background/50 px-3 py-2">
              <div className="text-[10px] uppercase tracking-wider text-muted">Active rate</div>
              <div className="mt-0.5 flex items-baseline gap-1">
                <span className="text-sm font-semibold tabular-nums text-foreground">
                  {sector.currentGrowthRate.toFixed(1)}%
                </span>
                <span
                  className="text-[10px] text-muted"
                  title={`Growth rates are per game year (${GROWTH_RATE_TURNS_PER_YEAR} turns). Money figures are per turn.`}
                >
                  /yr
                </span>
                {sector.currentGrowthRate !== sector.targetGrowthRate && (
                  <span
                    className="ml-1 text-[10px] text-primary"
                    title="Trending toward target by 0.5pp per turn"
                  >
                    {sector.currentGrowthRate < sector.targetGrowthRate ? "↑" : "↓"} target
                  </span>
                )}
              </div>
            </div>
            <div className="rounded-lg border border-card-border bg-background/50 px-3 py-2">
              <div className="text-[10px] uppercase tracking-wider text-muted">Current cost</div>
              <div className="mt-0.5 flex items-baseline gap-1">
                <span className="text-sm font-semibold tabular-nums text-error">
                  {perTurn(sector.currentGrowthCost)}
                </span>
                <span className="text-[10px] text-muted">/turn</span>
              </div>
              <p className="mt-1 text-[10px] leading-snug text-muted">
                You pay this every turn. Over one game year ({GROWTH_RATE_TURNS_PER_YEAR} turns)
                that is {GROWTH_COST_MULTIPLIER}× the revenue the growth adds.
              </p>
            </div>
          </div>

          {growthMessage && (
            <p className="mt-3 rounded-lg border border-error/30 bg-error/10 px-3 py-2 text-xs text-error">
              {growthMessage}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
