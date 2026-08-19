"use client";

import { useState } from "react";
import Link from "next/link";
import { useTranslations, useLocale } from "next-intl";
import { useCurrency } from "@/contexts/CurrencyContext";
import { type CurrencyCode, CURRENCY_SYMBOLS } from "@/lib/constants/currencies";
import { formatCurrencyFaceAmount } from "@/lib/currency/formatCurrencyFaceAmount";
import { formatCompactNumber } from "@/lib/utils/formatters";
import { InfoTooltip } from "@/components/InfoTooltip";

const INFO_ICON = (
  <svg
    className="inline-block h-3 w-3 ml-1 text-muted/50 pointer-events-none"
    fill="none"
    viewBox="0 0 24 24"
    stroke="currentColor"
  >
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={2}
      d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
    />
  </svg>
);

type FinancesT = ReturnType<typeof useTranslations>;

export interface CampaignIncomeData {
  populationTier: string;
  baseGen: number;
  donorBonus: number;
  officeBonus: number;
  unionContribution?: number;
  totalTax: number;
  netIncome: number;
}

export interface PersonalIncomeData {
  ceoSalaryPerHour?: number;
  /**
   * Currency of `ceoSalaryPerHour` — set when the CEO's corp's liquidCurrencyCode
   * differs from the viewer's home currency (v0.2.6). Null/undefined means the
   * value is already in ₳ (pre-forex CEO corp).
   */
  ceoSalaryCurrencyCode?: string | null;
  bondIncomePerTurn?: number;
  dividendIncomePerTurn?: number;
  portfolioValue?: number;
  /** Per-currency wallet balances (post-forex). Personal is liquid; savings is high-yield. */
  forexBalances?: {
    personal: Partial<Record<CurrencyCode, number>>;
    savings?: Partial<Record<CurrencyCode, number>>;
  };
}

export interface DonorIncomeData {
  /** Passive hourly income from donor network (donorBaseBonus after GDP scalar + influence) */
  passivePerHour: number;
  /** Per-level hourly rate for this population tier (before GDP scalar and influence) */
  perLevelRate: number;
  /** One-shot fundraise action yield (with influence multiplier applied) */
  /**
   * Already in campaign-treasury LOCAL face value (see `fundraiseYieldLocal`).
   * Rendered with `formatCurrencyFaceAmount`, never the FX-aware `formatFull`,
   * so the quote matches what the Fundraise action actually credits.
   */
  fundraiseYield: number;
  /** Population tier label (e.g. "mega", "large") */
  populationTier: string;
  /** Influence-based multiplier on donor income (1.0 at 0% → 2.0 at 100%) */
  influenceMultiplier: number;
}

interface FinancialStripProps {
  donorLevel: number;
  maxDonorLevel: number;
  /** Stored campaign-fund balance in the character's home/local currency. */
  campaignFunds: number;
  cashOnHand: number;
  /** ISO 4217 currency code for campaign and personal cash display (defaults to "USD") */
  currency?: string;
  /** If set, Donor Network cell is expandable with income breakdown. */
  donorIncome?: DonorIncomeData;
  /** If set, Campaign Funds cell is expandable with income breakdown. */
  campaignIncome?: CampaignIncomeData;
  /** If set, Cash on Hand cell is expandable with personal income breakdown. */
  personalIncome?: PersonalIncomeData;
  /** Destination for the "View Portfolio" / "View currency wallet" links.
   *  Defaults to `/portfolio` (viewer's own). Pass `/portfolio/${characterId}`
   *  when rendering on another player's profile. */
  portfolioHref?: string;
}

type Panel = "donor" | "campaign" | "cash" | null;

function DonorPanel({
  donorIncome,
  formatFull,
  currencyCode,
  t,
}: {
  donorIncome: DonorIncomeData;
  /** FX-aware formatter — applies display-currency preference + conversion. */
  formatFull: (internalAmount: number, nativeCurrencyCode?: CurrencyCode) => string;
  currencyCode: CurrencyCode;
  t: FinancesT;
}) {
  const mult = donorIncome.influenceMultiplier;
  const hasBoost = mult > 1.005;
  return (
    <div className="border-t border-card-border bg-card-elevated/30 px-5 py-3">
      <div className="space-y-1.5 text-xs">
        <div className="flex justify-between">
          <span className="text-muted">{t("passiveIncome")}</span>
          <span className="text-success tabular-nums">
            {t("plusPerHour", { amount: formatFull(donorIncome.passivePerHour, currencyCode) })}
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted">{t("perLevel", { tier: donorIncome.populationTier })}</span>
          <span className="text-muted tabular-nums">
            {t("plusPerHour", { amount: formatFull(donorIncome.perLevelRate, currencyCode) })}
          </span>
        </div>
        {hasBoost && (
          <div className="flex justify-between">
            <span className="text-muted">{t("influenceBonus")}</span>
            <span className="text-primary tabular-nums font-semibold">{mult.toFixed(2)}x</span>
          </div>
        )}
        <div className="flex justify-between pt-1.5 border-t border-card-border">
          <span className="text-muted">{t("fundraiseYield")}</span>
          <span className="text-foreground tabular-nums font-semibold">
            {formatCurrencyFaceAmount(donorIncome.fundraiseYield, currencyCode)}
          </span>
        </div>
      </div>
    </div>
  );
}

function CampaignPanel({
  campaignIncome,
  formatCampaignFull,
  t,
}: {
  campaignIncome: CampaignIncomeData;
  /** Full-line formatter — respects FOREX display preference (internal ₳ vs converted). */
  formatCampaignFull: (internalAmount: number) => string;
  t: FinancesT;
}) {
  return (
    <div className="border-t border-card-border bg-card-elevated/30 px-5 py-3">
      <div className="space-y-1.5 text-xs">
        <div className="flex justify-between">
          <span className="text-muted">
            {t("baseGen", { tier: campaignIncome.populationTier })}
          </span>
          <span className="text-success tabular-nums">
            +{formatCampaignFull(campaignIncome.baseGen)}
          </span>
        </div>
        {campaignIncome.donorBonus > 0 && (
          <div className="flex justify-between">
            <span className="text-muted">{t("donorBonus")}</span>
            <span className="text-success tabular-nums">
              +{formatCampaignFull(campaignIncome.donorBonus)}
            </span>
          </div>
        )}
        {campaignIncome.officeBonus > 0 && (
          <div className="flex justify-between">
            <span className="text-muted">{t("officeSalary")}</span>
            <span className="text-success tabular-nums">
              +{formatCampaignFull(campaignIncome.officeBonus)}
            </span>
          </div>
        )}
        {(campaignIncome.unionContribution ?? 0) > 0 && (
          <div className="flex justify-between">
            <span className="text-muted">{t("unionContribution")}</span>
            <span className="text-success tabular-nums">
              +{formatCampaignFull(campaignIncome.unionContribution ?? 0)}
            </span>
          </div>
        )}
        {campaignIncome.totalTax > 0 && (
          <div className="flex justify-between">
            <span className="text-muted">{t("partyTaxes")}</span>
            <span className="text-error tabular-nums">
              &minus;{formatCampaignFull(campaignIncome.totalTax)}
            </span>
          </div>
        )}
        <div className="flex justify-between border-t border-card-border pt-1.5 font-semibold">
          <span className="text-foreground">{t("netPerHour")}</span>
          <span
            className={`tabular-nums ${campaignIncome.netIncome >= 0 ? "text-success" : "text-error"}`}
          >
            {campaignIncome.netIncome >= 0 ? "+" : ""}
            {formatCampaignFull(campaignIncome.netIncome)}
          </span>
        </div>
      </div>
    </div>
  );
}

function CashPanel({
  personalIncome,
  formatFull,
  formatAmountChip,
  toInternalFrom,
  currencyCode,
  displayCurrencyPreference,
  portfolioHref,
  locale,
  t,
}: {
  personalIncome: PersonalIncomeData;
  formatFull: (internalAmount: number, nativeCurrencyCode?: CurrencyCode) => string;
  formatAmountChip: (internalAmount: number, nativeCurrencyCode?: CurrencyCode) => string;
  toInternalFrom: (amount: number, from: CurrencyCode) => number;
  currencyCode: CurrencyCode;
  displayCurrencyPreference: string;
  portfolioHref: string;
  locale: string;
  t: FinancesT;
}) {
  // ceoSalaryPerHour is stored in the corp's liquidCurrencyCode post-v0.2.6.
  // Normalize to ₳ so formatFull honors wallet-pref display.
  const ceoSalaryCode =
    (personalIncome.ceoSalaryCurrencyCode as CurrencyCode | null | undefined) ?? undefined;
  const ceoSalaryPerHour = personalIncome.ceoSalaryPerHour ?? 0;
  const ceoSalaryPerHourAnchor = ceoSalaryCode
    ? toInternalFrom(ceoSalaryPerHour, ceoSalaryCode)
    : ceoSalaryPerHour;

  const isHomeMode = displayCurrencyPreference === "home";

  const { forexBalances } = personalIncome;
  const forexCurrencies = forexBalances
    ? (
        Object.keys({
          ...forexBalances.personal,
          ...(forexBalances.savings ?? {}),
        }) as CurrencyCode[]
      )
        .filter((code) => {
          const liquid = forexBalances.personal[code] ?? 0;
          const savings = forexBalances.savings?.[code] ?? 0;
          return liquid > 0 || savings > 0;
        })
        .sort((a, b) => {
          const aTotal = (forexBalances.personal[a] ?? 0) + (forexBalances.savings?.[a] ?? 0);
          const bTotal = (forexBalances.personal[b] ?? 0) + (forexBalances.savings?.[b] ?? 0);
          return bTotal - aTotal;
        })
    : [];

  let totalAnchor = 0;
  for (const code of forexCurrencies) {
    const liquid = forexBalances!.personal[code] ?? 0;
    const savings = forexBalances!.savings?.[code] ?? 0;
    totalAnchor += toInternalFrom(liquid + savings, code);
  }

  // Grid columns: code | liquid | savings | [home equiv — home mode only]
  const gridCols = isHomeMode ? "2.5rem 1fr auto auto" : "2.5rem 1fr auto";

  return (
    <div className="border-t border-card-border bg-card-elevated/30 px-5 py-3">
      <div className="space-y-1.5 text-xs">
        {/* Per-currency wallet entries — CSS grid for consistent column alignment */}
        {forexCurrencies.length > 0 && (
          <div className="grid gap-x-3 gap-y-1.5" style={{ gridTemplateColumns: gridCols }}>
            {forexCurrencies.flatMap((code) => {
              const sym = CURRENCY_SYMBOLS[code] ?? code;
              const liquid = forexBalances!.personal[code] ?? 0;
              const savings = forexBalances!.savings?.[code] ?? 0;
              const liquidAnchor = toInternalFrom(liquid, code);
              const savingsAnchor = toInternalFrom(savings, code);

              if (isHomeMode) {
                // home mode: code | native liquid | native savings | ≈home equiv
                return [
                  <span key={`${code}-c`} className="text-muted font-mono self-center">
                    {code}
                  </span>,
                  <span
                    key={`${code}-l`}
                    className="tabular-nums text-right text-foreground self-center"
                  >
                    {sym}
                    {Math.round(liquid).toLocaleString(locale)}
                  </span>,
                  <span
                    key={`${code}-s`}
                    className="tabular-nums text-right text-muted self-center"
                  >
                    {savings > 0
                      ? t("savingsChip", { amount: `${sym}${formatCompactNumber(savings)}` })
                      : ""}
                  </span>,
                  <span
                    key={`${code}-h`}
                    className="tabular-nums text-right text-primary/70 self-center"
                  >
                    ≈{formatAmountChip(liquidAnchor + savingsAnchor)}
                  </span>,
                ];
              }

              // local / internal / named-currency: code | native liquid | native savings
              return [
                <span key={`${code}-c`} className="text-muted font-mono self-center">
                  {code}
                </span>,
                <span
                  key={`${code}-l`}
                  className="tabular-nums text-right text-foreground self-center"
                >
                  {sym}
                  {Math.round(liquid).toLocaleString(locale)}
                </span>,
                <span key={`${code}-s`} className="tabular-nums text-right text-muted self-center">
                  {savings > 0
                    ? `(${t("savingsChip", { amount: `${sym}${formatCompactNumber(savings)}` })})`
                    : ""}
                </span>,
              ];
            })}
          </div>
        )}

        {forexCurrencies.length > 0 && (
          <div className="flex justify-between border-t border-card-border pt-1.5 font-semibold">
            <span className="text-muted">{t("total")}</span>
            <span className="text-foreground tabular-nums">{formatFull(totalAnchor)}</span>
          </div>
        )}

        {/* Income flows that credit to personal cash */}
        {(ceoSalaryPerHour > 0 ||
          (personalIncome.bondIncomePerTurn ?? 0) > 0 ||
          (personalIncome.dividendIncomePerTurn ?? 0) > 0) && (
          <div
            className={`space-y-1.5${forexCurrencies.length > 0 ? " border-t border-card-border pt-1.5" : ""}`}
          >
            {ceoSalaryPerHour > 0 && (
              <div className="flex justify-between">
                <span className="text-muted">{t("ceoSalary")}</span>
                <span className="text-success tabular-nums">
                  {t("plusPerHour", {
                    amount: formatFull(ceoSalaryPerHourAnchor, ceoSalaryCode ?? currencyCode),
                  })}
                </span>
              </div>
            )}
            {(personalIncome.bondIncomePerTurn ?? 0) > 0 && (
              <div className="flex justify-between">
                <span className="text-muted">{t("bondIncome")}</span>
                <span className="text-success tabular-nums">
                  {t("plusPerTurn", {
                    amount: formatFull(personalIncome.bondIncomePerTurn!, currencyCode),
                  })}
                </span>
              </div>
            )}
            {(personalIncome.dividendIncomePerTurn ?? 0) > 0 && (
              <div className="flex justify-between">
                <span className="text-muted">{t("dividendIncome")}</span>
                <span className="text-success tabular-nums">
                  {t("plusPerTurn", {
                    amount: formatFull(personalIncome.dividendIncomePerTurn!, currencyCode),
                  })}
                </span>
              </div>
            )}
          </div>
        )}

        <div className="pt-1.5">
          <Link
            href={portfolioHref}
            className="text-xs text-primary hover:underline inline-flex items-center gap-1"
          >
            {t("viewPortfolio")}
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </Link>
        </div>
      </div>
    </div>
  );
}

export function FinancialStrip({
  donorLevel,
  maxDonorLevel,
  campaignFunds,
  cashOnHand,
  currency = "USD",
  donorIncome,
  campaignIncome,
  personalIncome,
  portfolioHref = "/portfolio",
}: FinancialStripProps) {
  const t = useTranslations("profile.finances");
  const locale = useLocale();
  const { formatAmountChip, formatFull, toInternalFrom, displayCurrencyPreference } = useCurrency();
  const [panel, setPanel] = useState<Panel>(null);
  const currencyCode = (currency || "USD") as CurrencyCode;
  const formatCampaignFull = (internalAmount: number) => formatFull(internalAmount, currencyCode);

  const toggle = (p: Panel) => setPanel((prev) => (prev === p ? null : p));

  // The `cashOnHand` prop is computed server-side via getTotalPersonalLiquidWealth,
  // which divides each per-currency balance by the SERVER-fetched FX rate to
  // yield ₳. The client then re-multiplies by the CLIENT-fetched FX rate for
  // display. When rates move between those two fetches (e.g. across a turn
  // boundary) the round-trip overshoots a same-currency value — Rashi #156's
  // $76M USD wallet reading as $84M in the header. When raw forex balances
  // are available we recompute the anchor here using client-side rates so the
  // header agrees with the wallet panel's "Total" line below it.
  const personalCashAnchor =
    personalIncome?.forexBalances?.personal !== undefined
      ? Object.entries(personalIncome.forexBalances.personal).reduce(
          (sum, [code, val]) => sum + toInternalFrom(val ?? 0, code as CurrencyCode),
          0
        )
      : cashOnHand;

  // Base cell style — applied to every cell
  const cell =
    "flex items-center justify-between px-4 py-3 transition-colors duration-150 hover:bg-card-elevated/40 active:bg-card-elevated/60";

  return (
    <div className="border-t border-card-border">
      {/* ── Mobile layout: stacked cells with inline panels ── */}
      <div className="sm:hidden">
        {/* Donor Network */}
        <div
          className={`${cell} border-b border-card-border${donorIncome ? " cursor-pointer select-none" : ""}`}
          onClick={donorIncome ? () => toggle("donor") : undefined}
          aria-expanded={panel === "donor"}
        >
          <InfoTooltip
            trigger={
              <span className="text-[11px] text-muted font-medium">
                {t("donorNetwork")}
                {INFO_ICON}
                {donorIncome && (
                  <span className="ml-1 text-[9px] text-primary/60">
                    {panel === "donor" ? "\u25B2" : "\u25BC"}
                  </span>
                )}
              </span>
            }
          >
            <p className="text-muted">
              {t("donorTooltip")}
              {donorIncome && ` ${t("tapIncomeBreakdown")}`}
            </p>
          </InfoTooltip>
          <span className="text-sm font-bold tabular-nums text-success">
            {t("level", { level: donorLevel })}
            <span className="text-[10px] text-muted font-normal ml-1">/ {maxDonorLevel}</span>
          </span>
        </div>
        {/* Donor panel — directly under donor cell on mobile */}
        {panel === "donor" && donorIncome && (
          <DonorPanel
            donorIncome={donorIncome}
            formatFull={formatFull}
            currencyCode={currencyCode}
            t={t}
          />
        )}

        {/* Campaign Funds */}
        <div
          className={`${cell} border-b border-card-border${campaignIncome ? " cursor-pointer select-none" : ""}`}
          onClick={campaignIncome ? () => toggle("campaign") : undefined}
          aria-expanded={panel === "campaign"}
        >
          <InfoTooltip
            trigger={
              <span className="text-[11px] text-muted font-medium">
                {t("campaignCash")}
                {INFO_ICON}
                {campaignIncome && (
                  <span className="ml-1 text-[9px] text-primary/60">
                    {panel === "campaign" ? "\u25B2" : "\u25BC"}
                  </span>
                )}
              </span>
            }
          >
            <p className="text-muted">
              {t("campaignTooltip")}
              {campaignIncome && ` ${t("tapHourlyBreakdown")}`}
            </p>
          </InfoTooltip>
          <span className="text-sm font-bold tabular-nums">
            {formatCurrencyFaceAmount(campaignFunds, currencyCode)}
          </span>
        </div>
        {/* Campaign panel — directly under campaign cell on mobile */}
        {panel === "campaign" && campaignIncome && (
          <CampaignPanel
            campaignIncome={campaignIncome}
            formatCampaignFull={formatCampaignFull}
            t={t}
          />
        )}

        {/* Cash on Hand */}
        <div
          className={`${cell}${personalIncome ? " cursor-pointer select-none" : ""}`}
          onClick={personalIncome ? () => toggle("cash") : undefined}
          aria-expanded={panel === "cash"}
        >
          <InfoTooltip
            trigger={
              <span className="text-[11px] text-muted font-medium">
                {t("personalCash")}
                {INFO_ICON}
                {personalIncome && (
                  <span className="ml-1 text-[9px] text-primary/60">
                    {panel === "cash" ? "\u25B2" : "\u25BC"}
                  </span>
                )}
              </span>
            }
          >
            <>
              <p className="text-muted">
                {t("personalTooltip")}
                {personalIncome && ` ${t("tapHourlyBreakdown")}`}
              </p>
              <Link
                href={portfolioHref}
                className="mt-2 inline-block text-xs text-primary hover:underline"
              >
                {t("viewWallet")}
              </Link>
            </>
          </InfoTooltip>
          <span className="text-sm font-bold tabular-nums">
            {formatAmountChip(personalCashAnchor, currencyCode)}
          </span>
        </div>
        {/* Cash panel — directly under cash cell on mobile */}
        {panel === "cash" && personalIncome && (
          <CashPanel
            personalIncome={personalIncome}
            formatFull={formatFull}
            formatAmountChip={formatAmountChip}
            toInternalFrom={toInternalFrom}
            currencyCode={currencyCode}
            displayCurrencyPreference={displayCurrencyPreference}
            portfolioHref={portfolioHref}
            locale={locale}
            t={t}
          />
        )}
      </div>

      {/* ── Desktop layout: 3-column grid with panels below ── */}
      <div className="hidden sm:block">
        <div className="grid grid-cols-3">
          {/* Donor Network */}
          <div
            className={`${cell} border-r border-card-border${donorIncome ? " cursor-pointer select-none" : ""}`}
            onClick={donorIncome ? () => toggle("donor") : undefined}
            aria-expanded={panel === "donor"}
          >
            <InfoTooltip
              trigger={
                <span className="text-[11px] text-muted font-medium">
                  {t("donorNetwork")}
                  {INFO_ICON}
                  {donorIncome && (
                    <span className="ml-1 text-[9px] text-primary/60">
                      {panel === "donor" ? "\u25B2" : "\u25BC"}
                    </span>
                  )}
                </span>
              }
            >
              <p className="text-muted">
                {t("donorTooltip")}
                {donorIncome && ` ${t("clickIncomeBreakdown")}`}
              </p>
            </InfoTooltip>
            <span className="text-sm font-bold tabular-nums text-success">
              {t("level", { level: donorLevel })}
              <span className="text-[10px] text-muted font-normal ml-1">/ {maxDonorLevel}</span>
            </span>
          </div>

          {/* Campaign Funds */}
          <div
            className={`${cell} border-r border-card-border${campaignIncome ? " cursor-pointer select-none" : ""}`}
            onClick={campaignIncome ? () => toggle("campaign") : undefined}
            aria-expanded={panel === "campaign"}
          >
            <InfoTooltip
              trigger={
                <span className="text-[11px] text-muted font-medium">
                  {t("campaignCash")}
                  {INFO_ICON}
                  {campaignIncome && (
                    <span className="ml-1 text-[9px] text-primary/60">
                      {panel === "campaign" ? "\u25B2" : "\u25BC"}
                    </span>
                  )}
                </span>
              }
            >
              <p className="text-muted">
                {t("campaignTooltip")}
                {campaignIncome && ` ${t("clickHourlyBreakdown")}`}
              </p>
            </InfoTooltip>
            <span className="text-sm font-bold tabular-nums">
              {formatCurrencyFaceAmount(campaignFunds, currencyCode)}
            </span>
          </div>

          {/* Cash on Hand */}
          <div
            className={`${cell}${personalIncome ? " cursor-pointer select-none" : ""}`}
            onClick={personalIncome ? () => toggle("cash") : undefined}
            aria-expanded={panel === "cash"}
          >
            <InfoTooltip
              trigger={
                <span className="text-[11px] text-muted font-medium">
                  {t("personalCash")}
                  {INFO_ICON}
                  {personalIncome && (
                    <span className="ml-1 text-[9px] text-primary/60">
                      {panel === "cash" ? "\u25B2" : "\u25BC"}
                    </span>
                  )}
                </span>
              }
            >
              <>
                <p className="text-muted">
                  {t("personalTooltip")}
                  {personalIncome && ` ${t("clickHourlyBreakdown")}`}
                </p>
                <Link
                  href={portfolioHref}
                  className="mt-2 inline-block text-xs text-primary hover:underline"
                >
                  {t("viewWallet")}
                </Link>
              </>
            </InfoTooltip>
            <span className="text-sm font-bold tabular-nums">
              {formatAmountChip(personalCashAnchor, currencyCode)}
            </span>
          </div>
        </div>

        {/* Panels span full width below the grid on desktop */}
        {panel === "donor" && donorIncome && (
          <DonorPanel
            donorIncome={donorIncome}
            formatFull={formatFull}
            currencyCode={currencyCode}
            t={t}
          />
        )}
        {panel === "campaign" && campaignIncome && (
          <CampaignPanel
            campaignIncome={campaignIncome}
            formatCampaignFull={formatCampaignFull}
            t={t}
          />
        )}
        {panel === "cash" && personalIncome && (
          <CashPanel
            personalIncome={personalIncome}
            formatFull={formatFull}
            formatAmountChip={formatAmountChip}
            toInternalFrom={toInternalFrom}
            currencyCode={currencyCode}
            displayCurrencyPreference={displayCurrencyPreference}
            portfolioHref={portfolioHref}
            locale={locale}
            t={t}
          />
        )}
      </div>
    </div>
  );
}
