"use client";

import { useEffect, useMemo, useState } from "react";
import { useGameEvents } from "@/hooks/useGameEvents";
import { useParams } from "next/navigation";
import { TreasuryMasthead, type BudgetLens } from "@/components/budget/treasury/TreasuryMasthead";
import { FiscalStatStrip } from "@/components/budget/treasury/FiscalStatStrip";
import { FiscalFlow } from "@/components/budget/treasury/FiscalFlow";
import { displayRevenueEntries } from "@/components/budget/treasury/displayRevenue";
import {
  BudgetBreakdownPanel,
  type BreakdownLine,
} from "@/components/budget/treasury/BudgetBreakdownPanel";
import { DebtCreditPanel } from "@/components/budget/treasury/DebtCreditPanel";
import { EconomicIndicators } from "@/components/budget/treasury/EconomicIndicators";
import { SovereignHealthPanel } from "@/components/budget/treasury/SovereignHealthPanel";
import { GrantsPanel } from "@/components/budget/treasury/GrantsPanel";
import { MinisterCallouts } from "@/components/budget/treasury/MinisterCallouts";
import { FiscalMechanicsNote } from "@/components/budget/treasury/FiscalMechanicsNote";
import { DefenseFundingNote } from "@/components/budget/treasury/DefenseFundingNote";
import { BudgetAuthoringPanel } from "@/components/uk/budget/BudgetAuthoringPanel";
import { PlannedEconomyPanel } from "@/components/economy/PlannedEconomyPanel";
import { Button, Skeleton, CardSkeleton, StatGridSkeleton, ListRowSkeleton } from "@/components/ui";
import { COUNTRY_CONFIGS, getCountryConfig, type CountryId } from "@/lib/constants/countries";
import { concentrationStatus } from "@/lib/nationalization/concentrationStatus";
import { getTreasuryIdentity } from "@/lib/constants/treasuryIdentity";
import { budgetUsdEquivalent } from "@/lib/currency/budgetUsdEquivalent";
import { currencySymbolSep } from "@/lib/currency/symbolSep";
import { useWorldFlags } from "@/hooks/useWorldFlags";
import { budgetApiUrl } from "@/lib/urls";
import { getCurrencyPrefix } from "@/lib/utils/budgetCalculations";
import { federalSurplus } from "@/lib/budget/federalSurplus";
import { resolveRatioGdp } from "@/lib/budget/gdpDenominator";
import {
  REVENUE_TO_TAX_BASE,
  COUNTRY_LABELS,
  humanizeKey,
  getNumericField,
  type SnapshotLaw,
  type DisplayEnactedLaw,
  type BudgetData,
} from "./BudgetPanels";

export function NationalBudgetClient() {
  const { code } = useParams<{ code: string }>();
  const { preset, loaded: worldFlagsLoaded } = useWorldFlags();
  const countryParam = code?.toUpperCase() as CountryId | undefined;
  const countryId: CountryId =
    countryParam && countryParam in COUNTRY_CONFIGS
      ? (countryParam as CountryId)
      : COUNTRY_CONFIGS.US.id;
  const config = getCountryConfig(countryId);

  const [data, setData] = useState<BudgetData | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedFY, setSelectedFY] = useState<number | null>(null);
  const [lens, setLens] = useState<BudgetLens>("public");
  const [compare, setCompare] = useState(false);
  const [reloadNonce, setReloadNonce] = useState(0);
  useGameEvents(
    () => setReloadNonce((nonce) => nonce + 1),
    ["turn_complete", "market_tick"],
    selectedFY === null
  );

  useEffect(() => {
    let cancelled = false;
    const url = selectedFY
      ? `${budgetApiUrl(countryId)}?fiscalYear=${selectedFY}`
      : budgetApiUrl(countryId);
    fetch(url)
      .then((res) => (res.ok ? res.json() : null))
      .then((json) => {
        if (!cancelled) setData(json);
      })
      .catch(() => {
        if (!cancelled) setData(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [countryId, selectedFY, reloadNonce]);

  const budgetCountryKey = (
    countryId in COUNTRY_LABELS ? countryId : COUNTRY_CONFIGS.US.id
  ) as keyof typeof COUNTRY_LABELS;
  const labels = COUNTRY_LABELS[budgetCountryKey];
  const moneyPrefix = getCurrencyPrefix(countryId, data?.budget.currencyCode);
  const isStaleCountryBudget =
    data?.budget?.countryId != null && data.budget.countryId !== countryId;

  const formatMoney = useMemo(() => {
    const sep = currencySymbolSep(moneyPrefix);
    return (n: number) => {
      const sign = n < 0 ? "-" : "";
      const abs = Math.abs(n);
      const body =
        abs >= 1e12
          ? `${(abs / 1e12).toFixed(1)}T`
          : abs >= 1e9
            ? `${(abs / 1e9).toFixed(1)}B`
            : `${(abs / 1e6).toFixed(1)}M`;
      return `${sign}${moneyPrefix}${sep}${body}`;
    };
  }, [moneyPrefix]);

  const formatUnitMoney = useMemo(() => {
    const sep = currencySymbolSep(moneyPrefix);
    return (n: number) =>
      `${moneyPrefix}${sep}${n.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
  }, [moneyPrefix]);

  if (loading || isStaleCountryBudget) {
    return (
      <main className="min-h-screen bg-background pb-16">
        <div className="mx-auto max-w-7xl space-y-6 px-4 py-6 sm:px-6">
          {/* Treasury masthead — identity band + fiscal stat strip */}
          <div className="overflow-hidden rounded-2xl border border-card-border bg-card shadow-card">
            <div className="flex flex-wrap items-center justify-between gap-4 p-5">
              <div className="flex items-center gap-3">
                <Skeleton className="h-12 w-12 rounded-xl" />
                <div className="space-y-2">
                  <Skeleton className="h-6 w-56" />
                  <Skeleton className="h-3 w-36" />
                </div>
              </div>
              <div className="flex gap-2">
                <Skeleton className="h-8 w-24 rounded-lg" />
                <Skeleton className="h-8 w-20 rounded-lg" />
              </div>
            </div>
            <div className="flex items-center overflow-x-auto divide-x divide-card-border border-t border-card-border">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="flex min-w-max flex-col gap-1.5 px-5 py-3">
                  <Skeleton className="h-2.5 w-16" />
                  <Skeleton className="h-5 w-20" />
                </div>
              ))}
            </div>
          </div>

          {/* Fiscal flow */}
          <CardSkeleton className="min-h-[180px] space-y-4">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
          </CardSkeleton>

          {/* Revenue + spending breakdown panels */}
          <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
            {[0, 1].map((i) => (
              <CardSkeleton key={i} className="min-h-[320px]">
                <Skeleton className="h-4 w-44 mb-4" />
                {Array.from({ length: 5 }).map((_, j) => (
                  <ListRowSkeleton key={j} lines={1} withBadge />
                ))}
              </CardSkeleton>
            ))}
          </div>

          {/* Debt & credit + economic indicators */}
          <div className="grid gap-6 lg:grid-cols-2">
            {[0, 1].map((i) => (
              <CardSkeleton key={i} className="min-h-[220px]">
                <Skeleton className="h-4 w-40 mb-4" />
                <StatGridSkeleton cols={2} count={4} />
              </CardSkeleton>
            ))}
          </div>
        </div>
      </main>
    );
  }

  if (!data) {
    return (
      <main className="min-h-screen bg-background pb-16">
        <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
          <div className="rounded-xl border border-card-border bg-card p-8 text-center">
            <p className="mb-4 text-muted">Failed to load budget data. Please try again.</p>
            <Button
              variant="primary"
              onClick={() => {
                setLoading(true);
                setReloadNonce((n) => n + 1);
              }}
            >
              Retry
            </Button>
          </div>
        </div>
      </main>
    );
  }

  const {
    budget,
    primeRate,
    turnsUntilFY,
    stateGrantBreakdown,
    enactedLaws,
    grantLabel,
    grantRecipientLabel,
  } = data;

  const describeLawCost = (law: DisplayEnactedLaw) => {
    if (law.annualCost != null) return formatMoney(law.annualCost);
    // New-generation catalog laws price through costModelV2 (routed first,
    // like the cost engine) — without this branch every catalog law fell
    // through to the misleading "No direct fiscal delta" fallback.
    if (law.costModelV2) {
      const parts: string[] = [];
      if (law.costModelV2.gdpCostFraction) {
        parts.push(`${(law.costModelV2.gdpCostFraction * 100).toFixed(2)}% of GDP`);
      }
      if (law.costModelV2.incomeCostFraction) {
        parts.push(
          `${(law.costModelV2.incomeCostFraction * 100).toFixed(2)}% of avg income/person`
        );
      }
      if (law.costModelV2.gdpRevenueFraction) {
        parts.push(`+${(law.costModelV2.gdpRevenueFraction * 100).toFixed(2)}% of GDP revenue`);
      }
      // Level 0 (repealed) carries an empty model — fall through to the
      // no-delta label, which is accurate there.
      if (parts.length > 0) return parts.join(" · ");
    }
    if (law.gdpPerCapitaMultiplier !== undefined) {
      return `${(law.gdpPerCapitaMultiplier * 100).toFixed(2)}% of GDP`;
    }
    if (law.annualCostPerCapita !== undefined) {
      return `${formatUnitMoney(law.annualCostPerCapita)}/person`;
    }
    if (law.annualCostUsd !== undefined) {
      return formatMoney(law.annualCostUsd);
    }
    if (law.budgetCost !== 0) {
      return `${law.budgetCost.toFixed(1)}% of budget`;
    }
    return "No direct fiscal delta";
  };

  const formatLawCost = (law: DisplayEnactedLaw | SnapshotLaw): string =>
    "costModel" in law ? law.costModel : describeLawCost(law as DisplayEnactedLaw);

  // Structured revenue lines for the expandable breakdown panel (rate + base).
  const revenueLines: BreakdownLine[] = displayRevenueEntries(budget.revenue).map(
    ([key, value]) => {
      const taxRate = getNumericField(budget.taxRates, key);
      const taxBaseField = REVENUE_TO_TAX_BASE[key];
      const storedTaxBase =
        taxBaseField && budget.taxBases
          ? (budget.taxBases as unknown as Record<string, number | undefined>)[taxBaseField]
          : undefined;
      const taxBase = storedTaxBase ?? (taxRate && taxRate > 0 ? value / (taxRate / 100) : 0);
      const hasBase =
        labels.taxBaseLabels[key as keyof typeof labels.taxBaseLabels] != null &&
        taxRate !== undefined;
      const label =
        labels.revenueLabels[key as keyof typeof labels.revenueLabels] ?? humanizeKey(key);
      return {
        id: key,
        label,
        description:
          labels.revenueDescriptions[key as keyof typeof labels.revenueDescriptions] ??
          `${label} receipts.`,
        amount: value,
        rate: taxRate ?? null,
        base: hasBase ? taxBase : null,
      };
    }
  );

  // Statutory tax laws govern revenue, not spending: the API enriches each with
  // `revenueTaxType` (the FederalTaxRates key it sets). File them under the
  // matching revenue line as "Governing statutes" (rate already shown above).
  for (const law of enactedLaws) {
    const revenueTaxType = (law as { revenueTaxType?: string }).revenueTaxType;
    if (!revenueTaxType) continue;
    const line = revenueLines.find((l) => l.id === revenueTaxType);
    if (line) (line.laws ??= []).push({ title: law.title, cost: "", year: law.enactedYear });
  }

  // Structured spending lines (laws / grants / debt-service), plus the synthetic
  // grants + debt-service lines. "tax" is a revenue concept, not an expenditure —
  // skip it (statutory tax laws bucket a ¥0 entry there; they live on revenue).
  const spendingLines: BreakdownLine[] = [
    ...Object.entries(budget.spending.byCategory)
      .filter(([key]) => key !== "tax")
      .map(([key, value]) => {
        const label =
          labels.spendingLabels[key as keyof typeof labels.spendingLabels] ?? humanizeKey(key);
        return {
          id: key,
          label,
          description:
            labels.spendingDescriptions[key as keyof typeof labels.spendingDescriptions] ??
            `${label} spending.`,
          amount: value,
          laws: enactedLaws
            .filter((law) => law.budgetCategory === key)
            .map((law) => ({ title: law.title, cost: formatLawCost(law), year: law.enactedYear })),
        };
      }),
    {
      id: "stateGrants",
      label: grantLabel,
      description: labels.grantDescription,
      amount: budget.spending.stateGrants,
      grants: stateGrantBreakdown.map((g) => ({
        id: g.stateId,
        name: g.stateName,
        amount: g.federalGrants,
      })),
    },
    {
      id: "debtInterest",
      label: labels.debtServiceLabel,
      description: labels.debtServiceDescription,
      amount: budget.spending.debtInterest,
      isDebt: true,
    },
  ];

  // State Enterprises line: the National Corporations' net per-turn result, in
  // local currency. Positive ⇒ a Revenue Sources line; a loss ⇒ an Expenditure
  // line. Per-turn (excluded from the annual bar) since SOEs settle each turn.
  const soeNet = Math.round(data.stateEnterpriseNet ?? 0);
  const soeConcentration = concentrationStatus(data.stateOwnershipConcentration ?? 0);
  const soeConcentrationNote =
    soeConcentration.tier === "none"
      ? ""
      : ` State ownership: ${Math.round(data.stateOwnershipConcentration ?? 0)}% of national corporate revenue (${soeConcentration.label}).`;
  const soeLine = (amount: number): BreakdownLine => ({
    id: "stateEnterprises",
    label: "State enterprises",
    description:
      "Net per-turn operating result of this country's National Corporations — remitted profit when in surplus, treasury-backed losses when in deficit." +
      soeConcentrationNote,
    amount,
    perTurn: true,
    soeLink: true,
  });
  const revenueLinesFinal = soeNet > 0 ? [...revenueLines, soeLine(soeNet)] : revenueLines;
  const organizationContributionPerTurn = Math.round(data.organizationContributions?.perTurn ?? 0);
  const organizationNames = [
    ...new Set(data.organizationContributions?.lines.map((line) => line.organizationId)),
  ]
    .map((organizationId) => organizationId.replaceAll("_", " "))
    .join(", ");
  const organizationKinds = [
    ...new Set(data.organizationContributions?.lines.map((line) => line.kind)),
  ].join(" and ");
  const organizationContributionLine: BreakdownLine = {
    id: "internationalOrganizations",
    label: "International organizations",
    description:
      `Recurring ${organizationKinds || "dues or tribute"}${organizationNames ? ` from ${organizationNames}` : ""}. ` +
      "Charged directly to the treasury and not included in annual spending.",
    amount: organizationContributionPerTurn,
    perTurn: true,
  };
  const spendingLinesFinal = [
    ...(soeNet < 0 ? [soeLine(Math.abs(soeNet))] : []),
    ...(organizationContributionPerTurn > 0 ? [organizationContributionLine] : []),
    ...spendingLines,
  ];

  const treasuryIdentity = getTreasuryIdentity(countryId);
  const fyHistory = data.fyHistory ?? [];
  const fyMin = fyHistory.length > 0 ? fyHistory[0].fy : budget.fiscalYear;
  const fyMax = fyHistory.length > 0 ? fyHistory[fyHistory.length - 1].fy : budget.fiscalYear;
  const isLive = !(data.isSnapshot ?? false);
  const prevFyPoint = fyHistory.find((p) => p.fy === budget.fiscalYear - 1) ?? null;
  const treasuryBalance = data.treasuryReserve ?? -(budget.debt?.principal ?? 0);
  // The `??` is load-bearing. `loadFederalBudgetDetail`'s historical-FY branch
  // returns early and never sets `liveGdpUnits`, so a snapshot view falls back
  // to that snapshot's own gdp rather than showing today's live figure. Do not
  // "simplify" this to `data.liveGdpUnits`.
  const displayGdp = data.liveGdpUnits ?? budget.gdp;
  // The minister lens is gated: a non-minister viewer (or a historical snapshot,
  // which never authorizes it) is always forced back to the Public lens. Derived
  // rather than reset via effect so toggling stays a pure render.
  const effectiveLens: BudgetLens = (data.isFinanceMinister ?? false) ? lens : "public";

  return (
    <main className="min-h-screen bg-background pb-16">
      <div className="mx-auto max-w-7xl space-y-6 px-4 py-6 sm:px-6">
        <TreasuryMasthead
          countryId={countryId}
          identity={treasuryIdentity}
          executiveLabel={config.executiveLabel}
          fiscalYear={budget.fiscalYear}
          fyMin={fyMin}
          fyMax={fyMax}
          setFy={(fy) => setSelectedFY(fy >= fyMax ? null : fy)}
          isLive={isLive}
          turnsUntilFY={turnsUntilFY}
          lens={effectiveLens}
          setLens={setLens}
          isFinanceMinister={data.isFinanceMinister ?? false}
          compare={compare}
          setCompare={setCompare}
          hasPrevFy={prevFyPoint != null}
          statStrip={
            <FiscalStatStrip
              sym={moneyPrefix}
              revenue={budget.revenue.total}
              spending={budget.spending.total}
              gdp={displayGdp}
              ratioGdp={resolveRatioGdp(budget)}
              gdpGrowth={budget.economicFactors.gdpGrowth}
              debtToGdp={budget.debtToGdpRatio}
              rating={budget.creditRating}
              treasuryReserve={treasuryBalance}
              treasuryCashLedgerEnabled={isLive && data.treasuryCashLedgerEnabled === true}
              treasuryCashLocal={budget.treasuryCashLocal ?? 0}
              bankClaimsDueLocal={(budget.bankSovereignClaims ?? []).reduce(
                (sum, claim) => sum + claim.amountLocal,
                0
              )}
              compare={compare}
              prev={prevFyPoint}
              toUsd={
                worldFlagsLoaded ? (n) => budgetUsdEquivalent(n, countryId, preset) : undefined
              }
            />
          }
        />

        <FiscalMechanicsNote
          sym={moneyPrefix}
          debtPrincipal={budget.debt.principal}
          rawGdp={budget.gdp}
          smoothedGdp={budget.gdpSmoothed}
          revenue={budget.revenue.total}
          spending={budget.spending.total}
          debtInterest={budget.spending.debtInterest ?? 0}
        />

        {isLive && data.defenseFunding ? (
          <DefenseFundingNote
            sym={moneyPrefix}
            funding={data.defenseFunding}
            soeNetPerTurn={data.stateEnterpriseNet ?? null}
            organizationContributions={data.organizationContributions ?? null}
          />
        ) : null}

        {isLive && countryId === COUNTRY_CONFIGS.UK.id ? (
          <BudgetAuthoringPanel countryCode="uk" />
        ) : null}

        {!isLive && (
          <div className="flex items-center gap-2.5 rounded-xl border border-warning/30 bg-warning/[0.06] px-4 py-3">
            <svg
              className="h-4 w-4 shrink-0 text-warning"
              viewBox="0 0 20 20"
              fill="currentColor"
              aria-hidden
            >
              <path
                fillRule="evenodd"
                d="M10 18a8 8 0 100-16 8 8 0 000 16zM9 9a1 1 0 012 0v3a1 1 0 11-2 0V9zm1-4a1 1 0 100 2 1 1 0 000-2z"
                clipRule="evenodd"
              />
            </svg>
            <div className="text-body-sm text-foreground/85">
              Viewing the <span className="font-semibold text-warning">FY{budget.fiscalYear}</span>{" "}
              historical snapshot.
            </div>
          </div>
        )}

        {effectiveLens === "minister" && (
          <MinisterCallouts
            inputs={{
              sym: moneyPrefix,
              revenueTotal: budget.revenue.total,
              spendingTotal: budget.spending.total,
              // Ratio basis, not the display level: these flags compare against
              // deficit and debt thresholds, so they must sit on the same
              // denominator as the stored `debtToGdpRatio` in the strip above.
              gdp: resolveRatioGdp(budget),
              debtPrincipal: budget.debt.principal,
              debtCeiling: budget.debt.ceiling,
              ceilingLabel: labels.ceilingLabel,
              gdpGrowth: budget.economicFactors.gdpGrowth,
              inflationRate: budget.economicFactors.inflationRate ?? 0,
            }}
            subtitle={labels.subtitle}
            fiscalYear={budget.fiscalYear}
          />
        )}

        <FiscalFlow
          revenue={revenueLines.map((r) => ({ label: r.label, value: r.amount }))}
          spending={spendingLines.map((r) => ({ label: r.label, value: r.amount }))}
          revenueTotal={budget.revenue.total}
          spendingTotal={budget.spending.total}
          sym={moneyPrefix}
          fiscalYear={budget.fiscalYear}
          accent={treasuryIdentity.accent}
        />

        <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
          <BudgetBreakdownPanel
            kind="revenue"
            title={labels.revenueTitle}
            lines={revenueLinesFinal}
            total={budget.revenue.total}
            sym={moneyPrefix}
            countryCode={countryId}
            grantRecipientLabel={grantRecipientLabel}
          />
          <BudgetBreakdownPanel
            kind="spending"
            title={labels.spendingTitle}
            lines={spendingLinesFinal}
            total={budget.spending.total}
            sym={moneyPrefix}
            countryCode={countryId}
            grantRecipientLabel={grantRecipientLabel}
          />
        </div>

        <div className="grid gap-6 lg:grid-cols-2">
          <DebtCreditPanel
            sym={moneyPrefix}
            principal={budget.debt.principal}
            interestRate={budget.debt.interestRate}
            ceiling={budget.debt.ceiling}
            ceilingLabel={labels.ceilingLabel}
            debtToGdp={budget.debtToGdpRatio}
            rating={budget.creditRating}
            trend={fyHistory.map((p) => p.debtToGdp * 100)}
            trendRange={
              fyHistory.length > 1
                ? `FY${fyHistory[0].fy}–FY${fyHistory[fyHistory.length - 1].fy}`
                : ""
            }
            compare={compare}
            prevDebtToGdp={prevFyPoint?.debtToGdp ?? null}
          />
          <EconomicIndicators
            countryId={countryId}
            inflationRate={budget.economicFactors.inflationRate ?? 0}
            gdpGrowth={budget.economicFactors.gdpGrowth}
            wageGrowth={budget.economicFactors.wageGrowth}
            primeRate={primeRate}
            deficitToGdp={
              resolveRatioGdp(budget) > 0
                ? (federalSurplus(budget) / resolveRatioGdp(budget)) * 100
                : 0
            }
          />
        </div>

        <PlannedEconomyPanel
          countryId={countryId}
          currentYear={data.currentYear}
          commandEconomyEnabled={data.commandEconomyEnabled}
          factors={budget.economicFactors}
        />

        <div className="grid gap-6 lg:grid-cols-2">
          {isLive && data.sovereign && (
            <SovereignHealthPanel sym={moneyPrefix} sovereign={data.sovereign} />
          )}
          <GrantsPanel
            title={grantLabel}
            recipientLabel={grantRecipientLabel}
            grants={stateGrantBreakdown.map((g) => ({
              id: g.stateId,
              name: g.stateName,
              amount: g.federalGrants,
            }))}
            total={budget.spending.stateGrants}
            sym={moneyPrefix}
          />
        </div>
      </div>
    </main>
  );
}
