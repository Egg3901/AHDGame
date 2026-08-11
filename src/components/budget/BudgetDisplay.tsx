"use client";

import type { FederalBudget, CreditRating } from "@/lib/db/types/budget";
import { useCurrency } from "@/contexts/CurrencyContext";
import type { CurrencyCode } from "@/lib/constants/currencies";
import { formatFundsCompact1dp } from "@/lib/utils/formatters";
import { Skeleton } from "@/components/ui";

export interface BudgetDisplayProps {
  budget: FederalBudget | null;
  primeRate: number;
  turnsUntilFY: number;
  loading?: boolean;
  error?: string | null;
  /** "national" shows Foreign Debt Ownership section; "regional" omits it */
  scope: "national" | "regional";
  /** Title label shown in the header */
  title?: string;
  /** When true, shows "Historical Snapshot" badge instead of "Next FY in Xt" */
  isSnapshot?: boolean;
  /** The fiscal year this snapshot represents */
  snapshotFiscalYear?: number;
  /** Currency symbol to use for formatting (e.g. "$", "£", "¥"). Defaults to "$". */
  currencySymbol?: string;
  /**
   * Budget's currency code (v0.2.6). When provided, money fields are normalized
   * to ₳ and routed through `useCurrency.formatAmount` so the viewer's wallet
   * preference (internal / home / local / pinned) governs display. When
   * omitted, falls back to the legacy `currencySymbol`-prefixed formatter so
   * pre-forex callers keep working.
   */
  currencyCode?: CurrencyCode | null;
  /** Signed national treasury balance (local currency): positive = surplus,
   *  negative = national debt. When set, shown as a headline stat (red when in
   *  the hole). National scope only. */
  treasuryReserve?: number;
}

function legacyFmt(n: number, currency = "$") {
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  if (abs >= 1_000_000_000_000) return `${sign}${currency}${(abs / 1_000_000_000_000).toFixed(2)}T`;
  if (abs >= 1_000_000_000) return `${sign}${currency}${(abs / 1_000_000_000).toFixed(2)}B`;
  if (abs >= 1_000_000) return `${sign}${currency}${(abs / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `${sign}${currency}${(abs / 1_000).toFixed(1)}K`;
  return `${sign}${currency}${abs.toFixed(0)}`;
}

function pct(n: number) {
  return `${n >= 0 ? "+" : ""}${n.toFixed(1)}%`;
}

/** Convert camelCase/snake_case keys to readable labels: socialSecurity → Social Security */
function humanizeKey(key: string) {
  return key
    .replace(/([A-Z])/g, " $1")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

const ALWAYS_VISIBLE_SPENDING_KEYS = new Set(["sectorSubsidies"]);

// Debt-to-GDP threshold markers (mirrors src/lib/budget/debt.ts DEBT_THRESHOLDS)
const DEBT_RATING_THRESHOLDS = [
  { maxRatio: 0.6, label: "60%" },
  { maxRatio: 0.8, label: "80%" },
  { maxRatio: 1.0, label: "100%" },
  { maxRatio: 1.2, label: "120%" },
  { maxRatio: 1.5, label: "150%" },
];

function creditRatingColor(rating: CreditRating) {
  switch (rating) {
    case "AAA":
    case "AA":
      return "bg-success/20 text-success";
    case "A":
      return "bg-primary/20 text-primary";
    case "BBB":
      return "bg-warning/20 text-warning";
    default:
      return "bg-error/20 text-error";
  }
}

function BarSegment({
  value,
  total,
  color,
  label,
  formatValue,
}: {
  value: number;
  total: number;
  color: string;
  label: string;
  formatValue: (n: number) => string;
}) {
  const pctWidth = total > 0 ? Math.max(0, Math.min(100, (value / total) * 100)) : 0;
  if (pctWidth < 0.5) return null;
  return (
    <div
      className={`${color} h-full flex items-center justify-center overflow-hidden text-[10px] font-medium`}
      style={{ width: `${pctWidth}%` }}
      title={`${label}: ${formatValue(value)}`}
    >
      {pctWidth > 6 ? label : ""}
    </div>
  );
}

export function BudgetDisplay({
  budget,
  primeRate,
  turnsUntilFY,
  loading,
  error,
  scope,
  title,
  isSnapshot,
  snapshotFiscalYear,
  currencySymbol = "$",
  currencyCode,
  treasuryReserve,
}: BudgetDisplayProps) {
  const { formatAmount, toInternalFrom, resolveDisplayAt } = useCurrency();
  // When a `currencyCode` is provided (v0.2.6 callers), normalize country-local
  // values to ₳ + pass the code so wallet preference governs display. Legacy
  // callers without a code fall back to the raw-symbol formatter.
  const f = (n: number) =>
    currencyCode
      ? formatAmount(toInternalFrom(n, currencyCode), currencyCode)
      : legacyFmt(n, currencySymbol);

  // Headline-stat formatter: identical conversion path to `f` (same wallet
  // preference + live rates via resolveDisplayAt — undefined snapshotRates makes
  // it use live rates), but always renders exactly one decimal (e.g. ¥126.0T)
  // so the headline row reads consistently.
  const fHeadline = (n: number) => {
    if (!currencyCode) return formatFundsCompact1dp(n, currencySymbol);
    const { value, symbol } = resolveDisplayAt(
      toInternalFrom(n, currencyCode),
      undefined,
      currencyCode
    );
    return formatFundsCompact1dp(value, symbol);
  };

  if (loading) {
    return (
      <div className="min-h-80 space-y-6">
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="rounded-xl border border-card-border bg-card p-4 space-y-2">
              <Skeleton className="h-3 w-24" />
              <Skeleton className="h-6 w-20" />
            </div>
          ))}
        </div>
        {Array.from({ length: 2 }).map((_, i) => (
          <div key={i} className="rounded-xl border border-card-border bg-card p-4 space-y-3">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-7 w-full" />
            <div className="flex flex-wrap gap-3">
              {Array.from({ length: 4 }).map((_, j) => (
                <Skeleton key={j} className="h-3 w-20" />
              ))}
            </div>
          </div>
        ))}
      </div>
    );
  }
  if (error) {
    return (
      <div className="text-sm text-error bg-error/10 rounded-lg px-4 py-3">Error: {error}</div>
    );
  }
  if (!budget) return null;

  const { revenue, spending, debt, economicFactors } = budget;

  const surplus = revenue.total - spending.total;
  const debtToGdp = budget.debtToGdpRatio;
  const deficitToGdp = budget.gdp > 0 ? (surplus / budget.gdp) * 100 : 0;

  // Revenue breakdown segments — colorblind-friendly, max contrast between neighbors
  const revenueSegments = [
    { key: "incomeTax", label: "Income Tax", value: revenue.incomeTax, color: "bg-blue-500/70" },
    { key: "payrollTax", label: "Payroll", value: revenue.payrollTax, color: "bg-amber-400/70" },
    {
      key: "domesticCorporateTax",
      label: "Corporate — Domestic",
      value: revenue.domesticCorporateTax,
      color: "bg-teal-400/70",
    },
    {
      key: "foreignCorporateTax",
      label: "Corporate — Foreign",
      value: revenue.foreignCorporateTax,
      color: "bg-cyan-500/70",
    },
    { key: "tariffs", label: "Tariffs", value: revenue.tariffs, color: "bg-violet-400/70" },
    {
      key: "healthcareIncome",
      label: "Healthcare",
      value: revenue.healthcareIncome,
      color: "bg-orange-400/70",
    },
    { key: "salesTax", label: "Sales Tax", value: revenue.salesTax, color: "bg-sky-400/70" },
    // DE Solidaritätszuschlag — only renders for DE budgets where the rate is set.
    // Filtered out below when value is 0/undefined so other countries show no row.
    {
      key: "solidaritySurcharge",
      label: "Solidaritätszuschlag",
      value: revenue.solidaritySurcharge ?? 0,
      color: "bg-rose-400/70",
    },
    // CN-specific lines — only render for CN budgets where the corresponding rate is set.
    // Filtered out below when value is 0/undefined so other countries show no row.
    {
      key: "landValueAddedTax",
      label: "Land VAT (土地增值税)",
      value: revenue.landValueAddedTax ?? 0,
      color: "bg-pink-400/70",
    },
    {
      key: "urbanMaintenanceTax",
      label: "Urban Maintenance (城建税)",
      value: revenue.urbanMaintenanceTax ?? 0,
      color: "bg-fuchsia-400/70",
    },
    {
      key: "stampDuty",
      label: "Stamp Duty",
      value: revenue.stampDuty ?? 0,
      color: "bg-purple-400/70",
    },
    // IE-specific lines — only render for IE budgets where the corresponding rate is set.
    {
      key: "universalSocialCharge",
      label: "Universal Social Charge (USC)",
      value: revenue.universalSocialCharge ?? 0,
      color: "bg-lime-400/70",
    },
    {
      key: "capitalGainsTax",
      label: "Capital Gains Tax",
      value: revenue.capitalGainsTax ?? 0,
      color: "bg-amber-400/70",
    },
    {
      key: "exciseDuty",
      label: "Excise Duty",
      value: revenue.exciseDuty ?? 0,
      color: "bg-orange-500/70",
    },
    {
      key: "propertyTax",
      label: "Local Property Tax",
      value: revenue.propertyTax ?? 0,
      color: "bg-emerald-500/70",
    },
    { key: "other", label: "Other", value: revenue.other, color: "bg-slate-400/50" },
  ].filter((segment) => {
    // Country-specific lines hide when value is 0/undefined
    if (
      segment.key === "solidaritySurcharge" ||
      segment.key === "landValueAddedTax" ||
      segment.key === "urbanMaintenanceTax" ||
      segment.key === "stampDuty" ||
      segment.key === "universalSocialCharge" ||
      segment.key === "capitalGainsTax" ||
      segment.key === "exciseDuty" ||
      segment.key === "propertyTax"
    ) {
      return segment.value > 0;
    }
    return true;
  });

  // Spending breakdown — byCategory + fixed lines
  // Colorblind-friendly palette: warm/cool alternation for max neighbor contrast
  const SPENDING_COLORS = [
    "bg-blue-500/70", // cool
    "bg-amber-400/70", // warm
    "bg-teal-400/70", // cool
    "bg-orange-400/70", // warm
    "bg-violet-400/70", // cool
    "bg-yellow-500/60", // warm
    "bg-sky-400/70", // cool
    "bg-rose-400/60", // warm
    "bg-slate-400/50", // neutral
  ];
  const spendingCategories = Object.entries(spending.byCategory).sort(([, a], [, b]) => b - a);
  const totalSpendingForBar = spending.total;

  // D/G scale bar — show up to 200%
  const dgBarMax = 2.0;
  const dgBarFill = Math.min(debtToGdp, dgBarMax) / dgBarMax;

  return (
    <div className="space-y-6">
      {/* Header */}
      {(title || turnsUntilFY > 0 || isSnapshot) && (
        <div className="flex items-center justify-between gap-4 flex-wrap">
          {title && <h2 className="text-lg font-semibold">{title}</h2>}
          {isSnapshot ? (
            <span className="text-xs text-muted bg-card border border-card-border rounded px-2 py-1">
              FY{snapshotFiscalYear} — Historical Snapshot
            </span>
          ) : turnsUntilFY > 0 ? (
            <span className="text-xs text-muted bg-card border border-card-border rounded px-2 py-1">
              FY{budget.fiscalYear} — Next FY in {turnsUntilFY}t
            </span>
          ) : null}
        </div>
      )}

      {/* Headline stats */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
        {[
          { label: "Annual Revenue", value: fHeadline(revenue.total), sub: null, highlight: false },
          {
            label: "Annual Spending",
            value: fHeadline(spending.total),
            sub: null,
            highlight: false,
          },
          {
            label: surplus >= 0 ? "Surplus" : "Deficit",
            value: fHeadline(Math.abs(surplus)),
            sub: null,
            highlight: surplus < 0,
          },
          {
            label: "GDP",
            value: fHeadline(budget.gdp),
            sub: `${pct(economicFactors.gdpGrowth)} growth`,
            highlight: false,
          },
          ...(treasuryReserve != null
            ? [
                {
                  label: "Treasury Balance",
                  value: fHeadline(Math.abs(treasuryReserve)),
                  sub: treasuryReserve < 0 ? "national debt" : "in surplus",
                  highlight: treasuryReserve < 0,
                },
              ]
            : []),
        ].map((card) => (
          <div
            key={card.label}
            className="rounded-xl border border-card-border bg-card p-4 space-y-1"
          >
            <p className="text-xs text-muted uppercase tracking-wider">{card.label}</p>
            <p
              className={`text-lg font-semibold ${card.highlight ? "text-error" : "text-foreground"}`}
            >
              {card.value}
            </p>
            {card.sub && <p className="text-xs text-muted">{card.sub}</p>}
          </div>
        ))}
      </div>

      {/* Revenue breakdown bar */}
      <div className="rounded-xl border border-card-border bg-card p-4 space-y-3">
        <p className="text-sm font-medium">Revenue Breakdown</p>
        <div className="h-7 w-full flex rounded overflow-hidden">
          {revenueSegments.map((seg) => (
            <BarSegment
              key={seg.key}
              value={seg.value}
              total={revenue.total}
              color={seg.color}
              label={seg.label}
              formatValue={f}
            />
          ))}
        </div>
        <div className="flex flex-wrap gap-3 text-xs text-muted">
          {revenueSegments
            .filter((s) => s.value > 0)
            .map((seg) => (
              <span key={seg.key}>
                <span className={`inline-block w-2.5 h-2.5 rounded-sm mr-1 ${seg.color}`} />
                {seg.label}: {f(seg.value)}
              </span>
            ))}
        </div>
      </div>

      {/* Spending breakdown bar */}
      <div className="rounded-xl border border-card-border bg-card p-4 space-y-3">
        <p className="text-sm font-medium">Spending Breakdown</p>
        <div className="h-7 w-full flex rounded overflow-hidden">
          {spendingCategories.map(([cat, amount], i) => (
            <BarSegment
              key={cat}
              value={amount}
              total={totalSpendingForBar}
              color={SPENDING_COLORS[i % SPENDING_COLORS.length]}
              label={humanizeKey(cat)}
              formatValue={f}
            />
          ))}
          {spending.stateGrants > 0 && (
            <BarSegment
              value={spending.stateGrants}
              total={totalSpendingForBar}
              color="bg-cyan-400/50"
              label="Grants"
              formatValue={f}
            />
          )}
          {spending.debtInterest > 0 && (
            <BarSegment
              value={spending.debtInterest}
              total={totalSpendingForBar}
              color="bg-yellow-500/60"
              label="Debt Interest"
              formatValue={f}
            />
          )}
        </div>
        <div className="flex flex-wrap gap-3 text-xs text-muted">
          {[
            ...spendingCategories.map(([cat, amount], i) => ({
              key: cat,
              label: humanizeKey(cat),
              amount,
              color: SPENDING_COLORS[i % SPENDING_COLORS.length],
            })),
            ...(spending.stateGrants > 0
              ? [
                  {
                    key: "stateGrants",
                    label: "State Grants",
                    amount: spending.stateGrants,
                    color: "bg-cyan-400/50",
                  },
                ]
              : []),
            ...(spending.debtInterest > 0
              ? [
                  {
                    key: "debtInterest",
                    label: "Debt Interest",
                    amount: spending.debtInterest,
                    color: "bg-yellow-500/60",
                  },
                ]
              : []),
          ]
            .filter((s) => s.amount > 0 || ALWAYS_VISIBLE_SPENDING_KEYS.has(s.key))
            .sort((a, b) => b.amount - a.amount)
            .map((s) => (
              <span key={s.label}>
                <span className={`inline-block w-2.5 h-2.5 rounded-sm mr-1 ${s.color}`} />
                {s.label}: {f(s.amount)}
              </span>
            ))}
        </div>
      </div>

      {/* Debt & Credit panel */}
      <div className="rounded-xl border border-card-border bg-card p-4 space-y-4">
        <p className="text-sm font-medium">Debt &amp; Credit</p>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
          <div>
            <p className="text-xs text-muted mb-0.5">Debt Principal</p>
            <p className="font-semibold">{f(debt.principal)}</p>
          </div>
          <div>
            <p className="text-xs text-muted mb-0.5">Debt-to-GDP</p>
            <p className="font-semibold">{(debtToGdp * 100).toFixed(1)}%</p>
          </div>
          <div>
            <p className="text-xs text-muted mb-0.5">Credit Rating</p>
            <span
              className={`text-xs font-semibold px-2 py-0.5 rounded ${creditRatingColor(budget.creditRating)}`}
            >
              {budget.creditRating}
            </span>
          </div>
          <div>
            <p className="text-xs text-muted mb-0.5">Effective Rate</p>
            <p className="font-semibold">{(debt.interestRate * 100).toFixed(2)}%</p>
          </div>
        </div>

        {/* D/G scale bar */}
        <div className="space-y-1">
          <div className="relative h-4 w-full rounded bg-muted/20 overflow-hidden">
            <div
              className={`h-full transition-all ${
                debtToGdp > 1.2
                  ? "bg-error/60"
                  : debtToGdp > 0.8
                    ? "bg-warning/60"
                    : "bg-success/60"
              }`}
              style={{ width: `${dgBarFill * 100}%` }}
            />
          </div>
          <div className="relative flex text-[10px] text-muted" style={{ height: "1rem" }}>
            {DEBT_RATING_THRESHOLDS.map((t) => (
              <span
                key={t.label}
                className="absolute transform -translate-x-1/2"
                style={{ left: `${(t.maxRatio / dgBarMax) * 100}%` }}
              >
                {t.label}
              </span>
            ))}
          </div>
          <p className="text-[10px] text-muted pt-2">D/G scale: 0–200%</p>
        </div>
      </div>

      {/* Foreign Debt Ownership — national scope only */}
      {scope === "national" && (
        <div className="rounded-xl border border-card-border bg-card p-4 space-y-2">
          <div className="flex items-center gap-2">
            <p className="text-sm font-medium">Foreign Debt Ownership</p>
            <span className="text-[10px] font-semibold bg-muted/20 text-muted px-1.5 py-0.5 rounded">
              Planned
            </span>
          </div>
          <p className="text-xs text-muted">
            Breakdown of domestic vs. foreign holders of sovereign debt, including foreign reserve
            accumulation by trade partners. Coming in a future update.
          </p>
        </div>
      )}

      {/* Economic Indicators */}
      <div className="rounded-xl border border-card-border bg-card p-4 space-y-3">
        <p className="text-sm font-medium">Economic Indicators</p>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 text-sm">
          {[
            {
              label: "Inflation Rate",
              value: `${(economicFactors.inflationRate ?? 0).toFixed(2)}%`,
              note: "2% target",
              highlight: Math.abs((economicFactors.inflationRate ?? 0) - 2) > 2,
            },
            {
              label: "Real GDP Growth",
              value: pct(economicFactors.gdpGrowth),
              note: null,
              highlight: economicFactors.gdpGrowth < 0,
            },
            {
              label: "Wage Growth",
              value: pct(economicFactors.wageGrowth),
              note: null,
              highlight: false,
            },
            {
              label: "Prime Rate",
              value: `${primeRate.toFixed(2)}%`,
              note: null,
              highlight: false,
            },
            {
              label: "Deficit-to-GDP",
              value: `${deficitToGdp.toFixed(2)}%`,
              note: null,
              highlight: deficitToGdp < -5,
            },
          ].map((ind) => (
            <div key={ind.label}>
              <p className="text-xs text-muted mb-0.5">{ind.label}</p>
              <p
                className={`font-semibold text-sm ${ind.highlight ? "text-error" : "text-foreground"}`}
              >
                {ind.value}
              </p>
              {ind.note && <p className="text-[10px] text-muted">{ind.note}</p>}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
