"use client";

import {
  MONEY_PERIODS,
  MONEY_PERIOD_LABEL,
  MONEY_PERIOD_SUFFIX,
  scaleMoney,
  unscaleMoney,
  type MoneyPeriod,
} from "@/lib/constants/moneyTimescale";

import { useState } from "react";
import { flushSync } from "react-dom";
import Link from "next/link";
import { LocalTime } from "@/components/time/LocalTime";
import {
  calcMarketingGrowth,
  calcLogisticsGrowth,
  calcRdGrowth,
  LOGISTICS_DECAY_RATE,
  RD_DECAY_RATE,
  CEO_SALARY_MAX_REVENUE_MULTIPLE,
  MARKETING_DIMINISHING_THRESHOLD,
  RD_DIMINISHING_THRESHOLD,
  RD_INNOVATION_INTERVAL,
  RD_INNOVATION_SCORE_THRESHOLD,
  getSprawlModifier,
  SPRAWL_SECTOR_THRESHOLD,
  LOGISTICS_MAX_SPRAWL_EFFECT,
} from "@/lib/constants/corporations";
import { useCurrency } from "@/contexts/CurrencyContext";
import { FinRowTip } from "../CorporationHelpers";
import { Meter } from "@/components/corporation/market/MarketPrimitives";
import { Slider } from "@/components/ui";
import type { CorporationDetail, Financials } from "../CorporationPageTypes";
import { CURRENCY_SYMBOLS, type CurrencyCode } from "@/lib/constants/currencies";
import { formatAccountingCost } from "@/lib/utils/formatters";
import { CapitalInjectionPanel } from "./CapitalInjectionPanel";
import { ShareBuybackEscrowPanel } from "./ShareBuybackEscrowPanel";
import ShareIssuanceModal from "../shares/ShareIssuanceModal";

interface CeoBudgetSubtabProps {
  corpId: string;
  corporation: CorporationDetail;
  financials: Financials;
  /** Number of sectors the corp operates (drives the sprawl-cap readout). */
  sectorCount: number;
  /** CEO's personal liquid wealth in ₳ (for the public-corp Fund company modal). */
  myCashOnHand: number;
  /** CEO's per-currency personal liquid balances (for the Fund company modal). */
  myCurrencyBalances?: Partial<Record<string, number>>;
  editMarketingBudget: string;
  setEditMarketingBudget: (val: string) => void;
  editLogisticsBudget: string;
  setEditLogisticsBudget: (val: string) => void;
  editRdBudget: string;
  setEditRdBudget: (val: string) => void;
  editCeoSalary: number;
  setEditCeoSalary: (val: number) => void;
  editShareBuybackMode: "instant" | "escrow";
  setEditShareBuybackMode: (val: "instant" | "escrow") => void;
  editEscrowFundingPerTurn: string;
  setEditEscrowFundingPerTurn: (val: string) => void;
  currentTurn: number;
  onRefresh: () => void;
  saving: boolean;
  onSaveSettings: () => void;
  editDividendRate: number;
  setEditDividendRate: (val: number) => void;
  dividendSaving: boolean;
  dividendError: string;
  dividendSuccess: string;
  onSaveDividend: () => void;
}

export default function CeoBudgetSubtab({
  corpId,
  corporation,
  financials,
  sectorCount,
  myCashOnHand,
  myCurrencyBalances,
  editMarketingBudget,
  setEditMarketingBudget,
  editLogisticsBudget,
  setEditLogisticsBudget,
  editRdBudget,
  setEditRdBudget,
  editCeoSalary,
  setEditCeoSalary,
  editShareBuybackMode,
  setEditShareBuybackMode,
  editEscrowFundingPerTurn,
  setEditEscrowFundingPerTurn,
  currentTurn,
  onRefresh,
  saving,
  onSaveSettings,
  editDividendRate,
  setEditDividendRate,
  dividendSaving,
  dividendError,
  dividendSuccess,
  onSaveDividend,
}: CeoBudgetSubtabProps) {
  const { formatAmount, toInternalFrom } = useCurrency();
  const [periodView, setPeriodView] = useState<MoneyPeriod>("turn");
  const [showFundCompanyModal, setShowFundCompanyModal] = useState(false);
  const [fundCooldownRemaining, setFundCooldownRemaining] = useState(0);

  // Post-v0.2.6: budgets, salary, revenue, and costs are stored in the corp's
  // liquidCurrencyCode. The CEO edits in that same currency — no wallet-pref
  // conversion on edit (would scramble keystrokes + hurts UX). Display rows
  // that aren't edit inputs pass `liquidCode` to formatAmount so viewers with
  // different wallet preferences see the right value after FX.
  const liquidCode = (corporation.liquidCurrencyCode as CurrencyCode | undefined) ?? undefined;
  const corpSymbol = liquidCode ? (CURRENCY_SYMBOLS[liquidCode] ?? "$") : "₳";
  const toAnchor = (localAmount: number) =>
    liquidCode ? toInternalFrom(localAmount, liquidCode) : localAmount;
  const fmtCost = (dailyLocal: number) =>
    formatAccountingCost(Math.round(scaleMoney(toAnchor(dailyLocal), periodView)), (n) =>
      formatAmount(n, liquidCode)
    );

  /** Raw text while focused — avoids rounding-on-keystroke corrupting digits. */
  const [marketingDraft, setMarketingDraft] = useState<string | null>(null);
  const [logisticsDraft, setLogisticsDraft] = useState<string | null>(null);
  const [rdDraft, setRdDraft] = useState<string | null>(null);
  const [ceoDraft, setCeoDraft] = useState<string | null>(null);

  // Budget values are stored as daily rates in corp currency.
  const dailyMarketingBudget = Math.max(0, Number(editMarketingBudget) || 0);
  const dailyLogisticsBudget = Math.max(0, Number(editLogisticsBudget) || 0);
  const dailyRdBudget = Math.max(0, Number(editRdBudget) || 0);
  const dailyCeoSalary = editCeoSalary;

  // Overhead cap: combined marketing + logistics + R&D + CEO salary cannot exceed
  // 150% of daily revenue. Only enforced when the corp has sectors (revenue > 0).
  const combinedDailyOverhead =
    dailyMarketingBudget + dailyLogisticsBudget + dailyRdBudget + dailyCeoSalary;
  const maxDailyOverhead = financials.totalRevenue > 0 ? financials.totalRevenue * 1.5 : Infinity;
  const isOverCap = isFinite(maxDailyOverhead) && combinedDailyOverhead > maxDailyOverhead;

  // Bug #0728: CEO salary alone is capped at 1.25x daily gross revenue (server-
  // enforced at set time and pay time). Zero revenue ⇒ $0. Surfaced here so the
  // input/slider can't commit a value the server will reject.
  const maxDailyCeoSalary = Math.floor(
    Math.max(0, financials.totalRevenue) * CEO_SALARY_MAX_REVENUE_MULTIPLE
  );

  // Edit inputs show raw local-currency values (no FX); period-adjust only.
  const displayMarketingBudget = Math.round(scaleMoney(dailyMarketingBudget, periodView));
  const displayLogisticsBudget = Math.round(scaleMoney(dailyLogisticsBudget, periodView));
  const displayRdBudget = Math.round(scaleMoney(dailyRdBudget, periodView));
  const displayCeoSalary = Math.round(scaleMoney(dailyCeoSalary, periodView));

  // Shared scale for the budget sliders (in display units). Caps at the 150%
  // overhead ceiling when revenue exists; otherwise falls back to 4× the largest
  // current line. Sliders + the typed inputs both read/commit the same derived
  // display value, so editing either keeps them in sync (last edit wins).
  const overheadCapDisplay = isFinite(maxDailyOverhead)
    ? Math.round(scaleMoney(maxDailyOverhead, periodView))
    : null;
  const budgetSliderMax = Math.max(
    overheadCapDisplay ??
      Math.max(displayMarketingBudget, displayLogisticsBudget, displayRdBudget, displayCeoSalary) *
        4,
    displayMarketingBudget,
    displayLogisticsBudget,
    displayRdBudget,
    displayCeoSalary,
    1
  );
  const budgetSliderStep = Math.max(1, Math.round(budgetSliderMax / 200));
  const overheadPct =
    financials.totalRevenue > 0 ? (combinedDailyOverhead / financials.totalRevenue) * 100 : 0;

  // For calculations, always use daily rates
  const currentMs = corporation?.marketingStrength ?? 0;
  const dailyMarketingBudgetAnchor = toAnchor(dailyMarketingBudget);
  const estimatedGain = calcMarketingGrowth(dailyMarketingBudgetAnchor, currentMs);

  const currentLs = corporation?.logisticsStrength ?? 0;
  const dailyLogisticsBudgetAnchor = toAnchor(dailyLogisticsBudget);
  const growth = calcLogisticsGrowth(dailyLogisticsBudgetAnchor);
  const decay = currentLs * LOGISTICS_DECAY_RATE;
  const netChange = growth - decay;
  const equilibrium =
    dailyLogisticsBudget > 0
      ? calcLogisticsGrowth(dailyLogisticsBudgetAnchor) / LOGISTICS_DECAY_RATE
      : 0;

  const currentRd = corporation?.rdScore ?? 0;
  const dailyRdBudgetAnchor = toAnchor(dailyRdBudget);
  const rdGrowth = calcRdGrowth(dailyRdBudgetAnchor, currentRd);
  const rdDecay = currentRd * RD_DECAY_RATE;
  const rdNetChange = rdGrowth - rdDecay;

  // Sprawl headroom: effective sector cap scales with logistics strength; the
  // penalty only applies above the cap (getSprawlModifier returns 0 below it).
  const hasSecondaryType = Boolean(corporation.secondaryType);
  const sprawlCap =
    SPRAWL_SECTOR_THRESHOLD +
    SPRAWL_SECTOR_THRESHOLD * (Math.max(0, currentLs) / LOGISTICS_MAX_SPRAWL_EFFECT);
  const sprawlPenalty = getSprawlModifier(sectorCount, currentLs, hasSecondaryType);

  // R&D innovation: min(1, score / threshold) rolled every RD_INNOVATION_INTERVAL turns.
  const innovationChancePct =
    Math.min(1, Math.max(0, currentRd) / RD_INNOVATION_SCORE_THRESHOLD) * 100;

  // Issuance cooldown mirrors useShareTrading: 24h after lastShareIssuance.
  // Computed on click (event handler, not render) to keep the component pure.
  const ISSUANCE_COOLDOWN_MS = 24 * 60 * 60 * 1000;
  function openFundCompanyModal() {
    const remaining = corporation.lastShareIssuance
      ? Math.max(
          0,
          ISSUANCE_COOLDOWN_MS - (Date.now() - new Date(corporation.lastShareIssuance).getTime())
        )
      : 0;
    setFundCooldownRemaining(remaining);
    setShowFundCompanyModal(true);
  }

  // Period-only conversion: inputs are already in corp currency, no FX round-trip.
  const handleSetMarketingBudget = (val: string) => {
    const displayVal = Number(val) || 0;
    const dailyLocal = unscaleMoney(displayVal, periodView);
    setEditMarketingBudget(String(Math.round(dailyLocal)));
  };

  const handleSetLogisticsBudget = (val: string) => {
    const displayVal = Number(val) || 0;
    const dailyLocal = unscaleMoney(displayVal, periodView);
    setEditLogisticsBudget(String(Math.round(dailyLocal)));
  };

  const handleSetRdBudget = (val: string) => {
    const displayVal = Number(val) || 0;
    const dailyLocal = unscaleMoney(displayVal, periodView);
    setEditRdBudget(String(Math.round(dailyLocal)));
  };

  const handleSetCeoSalary = (val: number) => {
    const dailyLocal = unscaleMoney(val, periodView);
    // Clamp to the 1.25x-gross-revenue ceiling (Bug #0728) so the input can't
    // commit a value the server will reject. Zero revenue ⇒ forced to 0.
    setEditCeoSalary(Math.min(Math.round(dailyLocal), maxDailyCeoSalary));
  };

  /**
   * Whole yen / display-currency amounts can exceed Number's safe integer range when typed
   * digit-by-digit. Parse via BigInt, then clamp to MAX_SAFE_INTEGER for downstream float math.
   */
  function parseCeoDisplayDigits(s: string): number {
    const cleaned = s.replace(/\D/g, "");
    if (cleaned === "") return 0;
    try {
      const bi = BigInt(cleaned);
      if (bi <= BigInt(0)) return 0;
      const max = BigInt(Number.MAX_SAFE_INTEGER);
      const v = bi > max ? max : bi;
      return Number(v);
    } catch {
      return 0;
    }
  }

  function commitCeoDraft() {
    if (ceoDraft === null) return;
    handleSetCeoSalary(parseCeoDisplayDigits(ceoDraft));
    setCeoDraft(null);
  }

  function commitAllBudgetDrafts() {
    if (marketingDraft !== null) {
      handleSetMarketingBudget(marketingDraft);
      setMarketingDraft(null);
    }
    if (logisticsDraft !== null) {
      handleSetLogisticsBudget(logisticsDraft);
      setLogisticsDraft(null);
    }
    if (rdDraft !== null) {
      handleSetRdBudget(rdDraft);
      setRdDraft(null);
    }
    if (ceoDraft !== null) {
      handleSetCeoSalary(parseCeoDisplayDigits(ceoDraft));
      setCeoDraft(null);
    }
  }

  return (
    <>
      {!corporation.countryOwnerId && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-card-border bg-card px-4 py-3">
          <p className="text-xs text-muted">
            Stocks and bonds held by this corporation use the same portfolio view as player
            investments.
          </p>
          <Link
            href={`/portfolio?corp=${encodeURIComponent(corpId)}`}
            className="shrink-0 text-xs font-semibold text-primary hover:underline"
          >
            Open portfolio
          </Link>
        </div>
      )}
      {/* Period toggle — options and conversion come from moneyTimescale */}
      <div className="flex items-center gap-1 rounded-lg bg-card-elevated p-1 w-full border border-card-border mb-4">
        {MONEY_PERIODS.map((k) => ({ key: k, label: MONEY_PERIOD_LABEL[k] })).map((period) => (
          <button
            key={period.key}
            type="button"
            onClick={() => {
              setPeriodView(period.key);
              setMarketingDraft(null);
              setLogisticsDraft(null);
              setRdDraft(null);
              setCeoDraft(null);
            }}
            className={`flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
              periodView === period.key
                ? "bg-primary text-white shadow-sm"
                : "text-muted hover:text-foreground"
            }`}
          >
            {period.label}
          </button>
        ))}
      </div>

      {/* Income Statement with editable budget lines */}
      <div className="rounded-xl border border-card-border bg-card overflow-hidden">
        <div className="border-b border-card-border bg-background/60 px-4 py-3 sm:px-6">
          <p className="text-xs text-muted">
            Budget &amp; Income — {MONEY_PERIOD_LABEL[periodView]}
          </p>
        </div>

        <div className="px-6 py-4 space-y-1">
          {/* Revenue */}
          <div className="text-[11px] font-semibold text-muted uppercase tracking-wider pt-1 pb-2">
            Revenue
          </div>
          <FinRowTip
            label="Gross Revenue"
            value={formatAmount(
              Math.round(scaleMoney(toAnchor(financials.totalRevenue), periodView)),
              liquidCode
            )}
            valueClass="text-foreground"
            tooltip="Total gross revenue from all owned sectors. Per-turn view shows one turn of income; annual view projects 48 turns (1 game year)."
          />

          {/* Cost of Revenue */}
          <div className="border-t border-card-border mt-3" />
          <div className="text-[11px] font-semibold text-muted uppercase tracking-wider pt-3 pb-2">
            Cost of Revenue
          </div>
          <FinRowTip
            label="Sector Maintenance"
            value={fmtCost(financials.maintenanceCosts)}
            valueClass={financials.maintenanceCosts < 0 ? "text-success" : "text-error"}
            indent
            tooltip={
              financials.maintenanceCosts < 0
                ? "A credit: wages currently exceed the derived operating bill. Gross Profit already nets this against Wages."
                : financials.laborCosts > 0
                  ? "Non-labour operating costs to keep sectors running. Labour is broken out as Wages below."
                  : "Operating costs to keep sectors running. Equals revenue × (1 - profit margin)."
            }
          />
          {financials.laborCosts > 0 && (
            <FinRowTip
              label="Wages"
              value={fmtCost(financials.laborCosts)}
              valueClass="text-error"
              indent
              tooltip="Total labour cost across all sectors, driven by employment, prevailing wage levels, and union wage demands. Carved out of Sector Maintenance."
            />
          )}
          <FinRowTip
            label="Growth Investment"
            value={fmtCost(financials.growthCosts)}
            valueClass="text-error"
            indent
            tooltip="Cost of growing sector revenue. Scales with revenue and growth rate."
          />

          {/* Gross Profit */}
          <div className="border-t border-card-border mt-3 pt-2">
            <FinRowTip
              label="Gross Profit"
              value={formatAmount(
                Math.round(
                  scaleMoney(
                    toAnchor(
                      financials.totalRevenue -
                        financials.maintenanceCosts -
                        financials.laborCosts -
                        financials.growthCosts
                    ),
                    periodView
                  )
                ),
                liquidCode
              )}
              valueClass={
                financials.totalRevenue -
                  financials.maintenanceCosts -
                  financials.laborCosts -
                  financials.growthCosts >=
                0
                  ? "text-foreground"
                  : "text-error"
              }
              bold
              tooltip="Revenue minus maintenance, wages, and growth costs."
            />
          </div>

          {/* Operating Expenses — editable */}
          <div className="border-t border-card-border mt-3" />
          <div className="text-[11px] font-semibold text-muted uppercase tracking-wider pt-3 pb-2">
            Operating Expenses
            <span className="ml-2 text-[10px] font-normal normal-case tracking-normal text-primary">
              (editable)
            </span>
          </div>

          {/* Marketing Budget — editable row (synced slider + input) */}
          <div className="py-1">
            <div className="flex items-center justify-between">
              <span className="text-sm pl-4 text-muted">+ Marketing</span>
              <div className="flex items-center gap-1.5">
                <span className="text-xs text-muted">{corpSymbol}</span>
                <input
                  type="text"
                  inputMode="numeric"
                  value={marketingDraft !== null ? marketingDraft : String(displayMarketingBudget)}
                  onFocus={() => setMarketingDraft(String(displayMarketingBudget))}
                  onChange={(e) => setMarketingDraft(e.target.value)}
                  onBlur={() => {
                    if (marketingDraft !== null) {
                      handleSetMarketingBudget(marketingDraft);
                      setMarketingDraft(null);
                    }
                  }}
                  className="min-w-[12rem] w-52 sm:min-w-[14rem] sm:w-60 rounded-md border border-primary/30 bg-primary/5 px-2 py-1 text-sm text-right tabular-nums font-medium focus:border-primary focus:outline-none"
                  placeholder="0"
                />
                <span className="text-xs text-muted">{MONEY_PERIOD_SUFFIX[periodView]}</span>
              </div>
            </div>
            <Slider
              variant="success"
              min={0}
              max={budgetSliderMax}
              step={budgetSliderStep}
              value={Math.min(budgetSliderMax, displayMarketingBudget)}
              onChange={(e) => {
                setMarketingDraft(null);
                handleSetMarketingBudget(e.target.value);
              }}
              aria-label="Marketing budget"
              className="mt-1.5 ml-4 w-[calc(100%-1rem)]"
            />
          </div>
          <p className="text-[10px] text-muted pl-4 -mt-0.5 mb-1">
            MS pool: {Math.round(currentMs)}. Splits cost more the more you bank; diminishing
            returns above {MARKETING_DIMINISHING_THRESHOLD}.
          </p>
          {dailyMarketingBudget > 0 && (
            <p className="text-[10px] text-primary pl-4 -mt-0.5 mb-1">
              → +{estimatedGain.toFixed(3)} MS/turn estimated
            </p>
          )}

          {/* Logistics Budget — editable row (synced slider + input) */}
          <div className="py-1">
            <div className="flex items-center justify-between">
              <span className="text-sm pl-4 text-muted">+ Logistics & Operations</span>
              <div className="flex items-center gap-1.5">
                <span className="text-xs text-muted">{corpSymbol}</span>
                <input
                  type="text"
                  inputMode="numeric"
                  value={logisticsDraft !== null ? logisticsDraft : String(displayLogisticsBudget)}
                  onFocus={() => setLogisticsDraft(String(displayLogisticsBudget))}
                  onChange={(e) => setLogisticsDraft(e.target.value)}
                  onBlur={() => {
                    if (logisticsDraft !== null) {
                      handleSetLogisticsBudget(logisticsDraft);
                      setLogisticsDraft(null);
                    }
                  }}
                  className="min-w-[12rem] w-52 sm:min-w-[14rem] sm:w-60 rounded-md border border-primary/30 bg-primary/5 px-2 py-1 text-sm text-right tabular-nums font-medium focus:border-primary focus:outline-none"
                  placeholder="0"
                />
                <span className="text-xs text-muted">{MONEY_PERIOD_SUFFIX[periodView]}</span>
              </div>
            </div>
            <Slider
              variant="success"
              min={0}
              max={budgetSliderMax}
              step={budgetSliderStep}
              value={Math.min(budgetSliderMax, displayLogisticsBudget)}
              onChange={(e) => {
                setLogisticsDraft(null);
                handleSetLogisticsBudget(e.target.value);
              }}
              aria-label="Logistics budget"
              className="mt-1.5 ml-4 w-[calc(100%-1rem)]"
            />
          </div>
          {
            <>
              {dailyLogisticsBudget > 0 && (
                <p className="text-[10px] text-primary pl-4 -mt-0.5 mb-1">
                  Net {netChange >= 0 ? "+" : ""}
                  {netChange.toFixed(2)} LS/turn (eq. ~{Math.round(equilibrium)} LS)
                </p>
              )}
              {dailyLogisticsBudget === 0 && currentLs > 0 && (
                <p className="text-[10px] text-warning pl-4 -mt-0.5 mb-1">
                  Decaying {decay.toFixed(2)} LS/turn
                </p>
              )}
              <p className="text-[10px] text-muted pl-4 -mt-0.5 mb-1">
                Sectors {sectorCount} / cap {Math.floor(sprawlCap)}
                {sectorCount > sprawlCap
                  ? `. Sprawl penalty ${sprawlPenalty.toFixed(1)}% to margins.`
                  : " (no penalty)."}
              </p>
            </>
          }

          {/* R&D Budget — editable row (synced slider + input) */}
          <div className="py-1">
            <div className="flex items-center justify-between">
              <span className="text-sm pl-4 text-muted">+ R&amp;D</span>
              <div className="flex items-center gap-1.5">
                <span className="text-xs text-muted">{corpSymbol}</span>
                <input
                  type="text"
                  inputMode="numeric"
                  value={rdDraft !== null ? rdDraft : String(displayRdBudget)}
                  onFocus={() => setRdDraft(String(displayRdBudget))}
                  onChange={(e) => setRdDraft(e.target.value)}
                  onBlur={() => {
                    if (rdDraft !== null) {
                      handleSetRdBudget(rdDraft);
                      setRdDraft(null);
                    }
                  }}
                  className="min-w-[12rem] w-52 sm:min-w-[14rem] sm:w-60 rounded-md border border-primary/30 bg-primary/5 px-2 py-1 text-sm text-right tabular-nums font-medium focus:border-primary focus:outline-none"
                  placeholder="0"
                />
                <span className="text-xs text-muted">{MONEY_PERIOD_SUFFIX[periodView]}</span>
              </div>
            </div>
            <Slider
              variant="success"
              min={0}
              max={budgetSliderMax}
              step={budgetSliderStep}
              value={Math.min(budgetSliderMax, displayRdBudget)}
              onChange={(e) => {
                setRdDraft(null);
                handleSetRdBudget(e.target.value);
              }}
              aria-label="R&D budget"
              className="mt-1.5 ml-4 w-[calc(100%-1rem)]"
            />
          </div>
          {dailyRdBudget > 0 && (
            <p className="text-[10px] text-primary pl-4 -mt-0.5 mb-1">
              Net {rdNetChange >= 0 ? "+" : ""}
              {rdNetChange.toFixed(2)} R&amp;D/turn (current {Math.round(currentRd)})
            </p>
          )}
          {dailyRdBudget === 0 && currentRd > 0 && (
            <p className="text-[10px] text-warning pl-4 -mt-0.5 mb-1">
              Decaying {rdDecay.toFixed(2)} R&amp;D/turn
            </p>
          )}
          <p className="text-[10px] text-muted pl-4 -mt-0.5 mb-1">
            Innovation chance ~{innovationChancePct.toFixed(0)}% (100% at{" "}
            {RD_INNOVATION_SCORE_THRESHOLD} R&amp;D), checked every {RD_INNOVATION_INTERVAL} turns.
            Diminishing returns above {RD_DIMINISHING_THRESHOLD}.
          </p>

          {/* CEO Salary — editable row (synced slider + input) */}
          <div className="py-1">
            <div className="flex items-center justify-between">
              <span className="text-sm pl-4 text-muted">+ CEO Compensation</span>
              <div className="flex items-center gap-1.5">
                <span className="text-xs text-muted">{corpSymbol}</span>
                <input
                  type="text"
                  inputMode="numeric"
                  value={ceoDraft !== null ? ceoDraft : String(displayCeoSalary)}
                  onFocus={() => setCeoDraft(String(displayCeoSalary))}
                  onChange={(e) => setCeoDraft(e.target.value)}
                  onBlur={commitCeoDraft}
                  className="min-w-[12rem] w-52 sm:min-w-[14rem] sm:w-60 rounded-md border border-primary/30 bg-primary/5 px-2 py-1 text-sm text-right tabular-nums font-medium focus:border-primary focus:outline-none"
                  placeholder="0"
                />
                <span className="text-xs text-muted">{MONEY_PERIOD_SUFFIX[periodView]}</span>
              </div>
            </div>
            <Slider
              variant="success"
              min={0}
              max={budgetSliderMax}
              step={budgetSliderStep}
              value={Math.min(budgetSliderMax, displayCeoSalary)}
              onChange={(e) => {
                setCeoDraft(null);
                handleSetCeoSalary(Number(e.target.value));
              }}
              aria-label="CEO compensation"
              className="mt-1.5 ml-4 w-[calc(100%-1rem)]"
            />
            <p className="text-[11px] text-muted mt-1.5 ml-4 leading-snug">
              CEO salary is capped at 1.25× the corporation&apos;s gross revenue.
            </p>
          </div>

          {/* Overhead cap meter + indicator — only shown when corp has revenue */}
          {isFinite(maxDailyOverhead) && (
            <div className="mt-2 space-y-1.5">
              <div className="flex items-center justify-between text-[11px]">
                <span className="font-semibold uppercase tracking-wider text-muted">
                  Total operating overhead
                </span>
                <span
                  className={`font-bold tabular-nums ${isOverCap ? "text-error" : "text-foreground"}`}
                >
                  {overheadPct.toFixed(0)}% of revenue
                </span>
              </div>
              <Meter
                value={Math.min(150, overheadPct)}
                max={150}
                tone={isOverCap ? "down" : overheadPct > 110 ? "warning" : "brand"}
                height={8}
              />
              <div className="flex justify-between text-[10px] text-muted">
                <span>combined budgets</span>
                <span className={isOverCap ? "font-semibold text-error" : ""}>150% cap</span>
              </div>
            </div>
          )}
          {isFinite(maxDailyOverhead) && (
            <div
              className={`mt-1 rounded-md px-3 py-2 text-xs ${
                isOverCap
                  ? "bg-error/10 text-error border border-error/20"
                  : "bg-card-elevated text-muted border border-card-border"
              }`}
            >
              <span className="font-medium">Overhead budget:</span>{" "}
              {formatAmount(
                Math.round(toAnchor(scaleMoney(combinedDailyOverhead, periodView))),
                liquidCode
              )}{" "}
              /{" "}
              {formatAmount(
                Math.round(toAnchor(scaleMoney(maxDailyOverhead, periodView))),
                liquidCode
              )}{" "}
              cap (150% of revenue)
              {isOverCap && (
                <span className="block mt-0.5 font-medium">Reduce budgets before saving.</span>
              )}
            </div>
          )}

          <div className="pt-2">
            <button
              type="button"
              onClick={() => {
                flushSync(() => {
                  commitAllBudgetDrafts();
                });
                onSaveSettings();
              }}
              disabled={saving || isOverCap}
              className="rounded-lg bg-primary px-4 py-1.5 text-xs font-medium text-white hover:bg-primary/90 transition-colors disabled:opacity-50"
            >
              {saving ? "Saving..." : "Save Budgets"}
            </button>
          </div>

          {/* Operating Income */}
          <div className="border-t border-card-border mt-3 pt-2">
            <FinRowTip
              label="Operating Income (EBIT)"
              value={formatAmount(
                Math.round(scaleMoney(toAnchor(financials.operatingIncome), periodView)),
                liquidCode
              )}
              valueClass={financials.operatingIncome >= 0 ? "text-foreground" : "text-error"}
              bold
              tooltip="Earnings before interest. Revenue minus all operating costs."
            />
          </div>

          {/* Interest */}
          {(financials.bondInterestCost > 0 || financials.imfFacilityPaymentDaily > 0) && (
            <>
              <div className="border-t border-card-border mt-3" />
              <div className="text-[11px] font-semibold text-muted uppercase tracking-wider pt-3 pb-2">
                Interest Expense
              </div>
              {financials.bondInterestCost > 0 && (
                <FinRowTip
                  label="Bond Interest"
                  value={`(${formatAmount(Math.round(scaleMoney(toAnchor(financials.bondInterestCost), periodView)), liquidCode)})`}
                  valueClass="text-error"
                  indent
                  tooltip="Interest expense on outstanding bonds."
                />
              )}
              {financials.governmentBondSubsidy > 0 && (
                <FinRowTip
                  label="Gov't Bond Subsidy"
                  value={formatAmount(
                    Math.round(scaleMoney(toAnchor(financials.governmentBondSubsidy), periodView)),
                    liquidCode
                  )}
                  valueClass="text-success"
                  indent
                  tooltip="Government contribution covering bond interest costs for state-owned enterprises."
                />
              )}
              {financials.imfFacilityPaymentDaily > 0 && (
                <FinRowTip
                  label="IMF Facility Payment"
                  value={`(${formatAmount(Math.round(scaleMoney(toAnchor(financials.imfFacilityPaymentDaily), periodView)), liquidCode)})`}
                  valueClass="text-error"
                  indent
                  tooltip="Scheduled payment on the active IMF restructuring facility."
                />
              )}
            </>
          )}

          {(financials.bondCouponIncome > 0 || financials.imfFacilityReceiptsDaily > 0) && (
            <>
              <div className="border-t border-card-border mt-3" />
              <div className="text-[11px] font-semibold text-muted uppercase tracking-wider pt-3 pb-2">
                Interest Income
              </div>
              {financials.bondCouponIncome > 0 && (
                <FinRowTip
                  label="Bond Coupon Income"
                  value={formatAmount(
                    Math.round(scaleMoney(toAnchor(financials.bondCouponIncome), periodView)),
                    liquidCode
                  )}
                  valueClass="text-success"
                  indent
                  tooltip="Coupon income from bonds held in corporate portfolio."
                />
              )}
              {financials.imfFacilityReceiptsDaily > 0 && (
                <FinRowTip
                  label="IMF Facility Receipts"
                  value={formatAmount(
                    Math.round(
                      scaleMoney(toAnchor(financials.imfFacilityReceiptsDaily), periodView)
                    ),
                    liquidCode
                  )}
                  valueClass="text-success"
                  indent
                  tooltip="Cash received as IMF lender on facility loans."
                />
              )}
            </>
          )}

          {/* Net Income */}
          <div className="border-t border-card-border mt-3 pt-2">
            <FinRowTip
              label="Net Income"
              value={formatAmount(
                Math.round(scaleMoney(toAnchor(financials.income), periodView)),
                liquidCode
              )}
              valueClass={financials.income >= 0 ? "text-foreground" : "text-error"}
              bold
              tooltip="Final profit after all expenses and interest."
            />
          </div>
        </div>
      </div>

      {/* Dividend Rate */}
      <div className="rounded-xl border border-card-border bg-card overflow-hidden">
        <div className="border-b border-card-border bg-background/60 px-6 py-4">
          <h2 className="text-lg font-bold text-foreground">Dividend Policy</h2>
          <p className="text-xs text-muted mt-0.5">
            Percentage of net income distributed to shareholders each turn
          </p>
        </div>
        <div className="px-6 py-4 space-y-3">
          <div className="flex items-center gap-4">
            <Slider
              variant="success"
              min={0}
              max={25}
              step={5}
              value={editDividendRate}
              onChange={(e) => setEditDividendRate(Number(e.target.value))}
              aria-label="Dividend rate"
              className="flex-1"
            />
            <span className="text-sm font-medium tabular-nums w-12 text-right">
              {editDividendRate}%
            </span>
          </div>

          {financials.income > 0 && (
            <p className="text-xs text-muted">
              Estimated payout:{" "}
              {`${formatAmount(
                Math.round(
                  scaleMoney(toAnchor((financials.income * editDividendRate) / 100), periodView)
                ),
                liquidCode
              )}/hour`}
            </p>
          )}

          {corporation.lastDividendChange && (
            <p className="text-[10px] text-muted">
              Last changed:{" "}
              <LocalTime value={corporation.lastDividendChange} options={{ dateStyle: "medium" }} />
            </p>
          )}

          {dividendError && (
            <div className="rounded-lg border border-error/30 bg-error/10 p-2 text-xs text-error">
              {dividendError}
            </div>
          )}
          {dividendSuccess && (
            <div className="rounded-lg border border-success/30 bg-success/10 p-2 text-xs text-success">
              {dividendSuccess}
            </div>
          )}

          <button
            onClick={onSaveDividend}
            disabled={dividendSaving || editDividendRate === (corporation.dividendRate ?? 0)}
            className="rounded-lg bg-primary px-4 py-1.5 text-xs font-medium text-white hover:bg-primary/90 transition-colors disabled:opacity-50"
          >
            {dividendSaving ? "Saving..." : "Update Dividend Rate"}
          </button>
        </div>
      </div>

      {/* Share Buyback & Escrow — public corps only (private corps have no traded float) */}
      {!corporation.isPrivate && !corporation.countryOwnerId && (
        <ShareBuybackEscrowPanel
          corpId={corpId}
          corporation={corporation}
          currentTurn={currentTurn}
          editShareBuybackMode={editShareBuybackMode}
          setEditShareBuybackMode={setEditShareBuybackMode}
          editEscrowFundingPerTurn={editEscrowFundingPerTurn}
          setEditEscrowFundingPerTurn={setEditEscrowFundingPerTurn}
          saving={saving}
          onSaveSettings={onSaveSettings}
          onRefresh={onRefresh}
        />
      )}

      {/* Capital Injection — private corps only */}
      {corporation.isPrivate && <CapitalInjectionPanel corpId={corpId} corporation={corporation} />}

      {/* Fund company — public corps: CEO buys newly issued shares at a premium to
          move personal cash into the company. */}
      {!corporation.isPrivate && !corporation.countryOwnerId && (
        <div className="rounded-xl border border-card-border bg-card p-4 space-y-3">
          <div>
            <h3 className="text-sm font-semibold text-foreground">Fund company</h3>
            <p className="text-xs text-muted mt-0.5">
              Buy newly issued shares to put personal cash into the company (15% premium, which the
              company keeps).
            </p>
          </div>
          <div>
            <button
              type="button"
              onClick={openFundCompanyModal}
              className="rounded-lg bg-primary px-4 py-1.5 text-xs font-medium text-white hover:bg-primary/90 transition-colors"
            >
              Fund company
            </button>
          </div>
        </div>
      )}
      {showFundCompanyModal && (
        <ShareIssuanceModal
          corporation={corporation}
          corpId={corpId}
          myCashOnHand={myCashOnHand}
          myCurrencyBalances={myCurrencyBalances}
          issuanceOnCooldown={fundCooldownRemaining > 0}
          issuanceCooldownRemaining={fundCooldownRemaining}
          initialMode="ceo"
          onClose={() => setShowFundCompanyModal(false)}
          onSuccess={onRefresh}
        />
      )}
    </>
  );
}
