"use client";

import { useState } from "react";
import Link from "next/link";
import { useTranslations, useLocale } from "next-intl";
import { useCurrency } from "@/contexts/CurrencyContext";
import { type CurrencyCode, CURRENCY_SYMBOLS } from "@/lib/constants/currencies";
import { formatCurrencyFaceAmount } from "@/lib/currency/formatCurrencyFaceAmount";
import { formatCompactNumber } from "@/lib/utils/formatters";
import { InfoTooltip } from "@/components/InfoTooltip";
import { PROFILE_LINK_CLASS } from "./profileStyles";

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
    <div className="border-t border-card-border/60 py-3">
      <div className="space-y-1.5 text-body-sm">
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
            <span className="text-foreground tabular-nums font-semibold">{mult.toFixed(2)}x</span>
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
    <div className="border-t border-card-border/60 py-3">
      <div className="space-y-1.5 text-body-sm">
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
    <div className="border-t border-card-border/60 py-3">
      <div className="space-y-1.5 text-body-sm">
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
                    className="tabular-nums text-right text-muted self-center"
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
          <Link href={portfolioHref} className={PROFILE_LINK_CLASS}>
            {t("viewPortfolio")}
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

  const donorTooltip = (breakdownHint: string) => (
    <p className="text-muted">
      {t("donorTooltip")}
      {donorIncome && ` ${t(breakdownHint)}`}
    </p>
  );
  const campaignTooltip = (breakdownHint: string) => (
    <p className="text-muted">
      {t("campaignTooltip")}
      {campaignIncome && ` ${t(breakdownHint)}`}
    </p>
  );
  const personalTooltip = (breakdownHint: string) => (
    <>
      <p className="text-muted">
        {t("personalTooltip")}
        {personalIncome && ` ${t(breakdownHint)}`}
      </p>
      <Link href={portfolioHref} className={`mt-2 inline-block text-body-sm ${PROFILE_LINK_CLASS}`}>
        {t("viewWallet")}
      </Link>
    </>
  );

  const donorValue = (
    <span className="text-heading font-semibold tabular-nums text-foreground">
      {t("level", { level: donorLevel })}
      <span className="ml-1 text-body font-normal text-muted">/ {maxDonorLevel}</span>
    </span>
  );
  const campaignValue = (
    <span className="text-heading font-semibold tabular-nums text-foreground">
      {formatCurrencyFaceAmount(campaignFunds, currencyCode)}
    </span>
  );
  const personalValue = (
    <span className="text-heading font-semibold tabular-nums text-foreground">
      {formatAmountChip(personalCashAnchor, currencyCode)}
    </span>
  );

  const donorPanel = panel === "donor" && donorIncome && (
    <DonorPanel
      donorIncome={donorIncome}
      formatFull={formatFull}
      currencyCode={currencyCode}
      t={t}
    />
  );
  const campaignPanel = panel === "campaign" && campaignIncome && (
    <CampaignPanel campaignIncome={campaignIncome} formatCampaignFull={formatCampaignFull} t={t} />
  );
  const cashPanel = panel === "cash" && personalIncome && (
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
  );

  return (
    <div>
      {/* Mobile: figures stacked, each breakdown directly under its figure */}
      <div className="space-y-2 sm:hidden">
        <Figure
          label={t("donorNetwork")}
          tooltip={donorTooltip("tapIncomeBreakdown")}
          expandable={!!donorIncome}
          open={panel === "donor"}
          onToggle={() => toggle("donor")}
          value={donorValue}
        />
        {donorPanel}
        <Figure
          label={t("campaignCash")}
          tooltip={campaignTooltip("tapHourlyBreakdown")}
          expandable={!!campaignIncome}
          open={panel === "campaign"}
          onToggle={() => toggle("campaign")}
          value={campaignValue}
        />
        {campaignPanel}
        <Figure
          label={t("personalCash")}
          tooltip={personalTooltip("tapHourlyBreakdown")}
          expandable={!!personalIncome}
          open={panel === "cash"}
          onToggle={() => toggle("cash")}
          value={personalValue}
        />
        {cashPanel}
      </div>

      {/* Desktop: three figures side by side, the open breakdown below them */}
      <div className="hidden sm:block">
        <div className="grid grid-cols-3 gap-6">
          <Figure
            label={t("donorNetwork")}
            tooltip={donorTooltip("clickIncomeBreakdown")}
            expandable={!!donorIncome}
            open={panel === "donor"}
            onToggle={() => toggle("donor")}
            value={donorValue}
          />
          <Figure
            label={t("campaignCash")}
            tooltip={campaignTooltip("clickHourlyBreakdown")}
            expandable={!!campaignIncome}
            open={panel === "campaign"}
            onToggle={() => toggle("campaign")}
            value={campaignValue}
          />
          <Figure
            label={t("personalCash")}
            tooltip={personalTooltip("clickHourlyBreakdown")}
            expandable={!!personalIncome}
            open={panel === "cash"}
            onToggle={() => toggle("cash")}
            value={personalValue}
          />
        </div>
        {donorPanel}
        {campaignPanel}
        {cashPanel}
      </div>
    </div>
  );
}

/**
 * One finance figure: a small muted label above the amount. When a breakdown
 * exists the whole figure toggles it; the label keeps its explanatory tooltip.
 */
function Figure({
  label,
  tooltip,
  expandable,
  open,
  onToggle,
  value,
}: {
  label: string;
  tooltip: React.ReactNode;
  expandable: boolean;
  open: boolean;
  onToggle: () => void;
  value: React.ReactNode;
}) {
  return (
    <div
      className={`flex flex-col items-start gap-0.5 py-1${expandable ? " cursor-pointer select-none" : ""}`}
      onClick={expandable ? onToggle : undefined}
      aria-expanded={open}
    >
      <InfoTooltip
        trigger={
          <span className="text-body-sm text-muted">
            {label}
            {expandable && (
              <span aria-hidden className="ml-1.5 text-body-xs">
                {open ? "\u25B2" : "\u25BC"}
              </span>
            )}
          </span>
        }
      >
        {tooltip}
      </InfoTooltip>
      {value}
    </div>
  );
}
