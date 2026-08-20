"use client";

import { useState, useEffect, useCallback } from "react";
import { useSearchParams, useRouter, usePathname } from "next/navigation";
import { InfoTooltip } from "@/components/InfoTooltip";
import {
  InstitutionMasthead,
  MastheadChip,
  MastheadStat,
} from "@/components/national/InstitutionMasthead";
import { getBankIdentity } from "@/lib/constants/institutionIdentity";
import { getBankId } from "@/lib/centralBank/helpers";
import { useCurrency } from "@/contexts/CurrencyContext";
import { RateCorridor } from "./components/RateCorridor";
import { formatNativeCurrency } from "./components/centralBankUtils";
import { EconomicTrendsChart } from "@/components/charts/EconomicTrendsChart";
import { Button } from "@/components/ui";
import BackButton from "@/components/BackButton";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { centralBankApiUrl } from "@/lib/urls";
import { CREDIT_RATINGS } from "@/lib/db/types/centralBank";
import {
  FOREX_ACTIVE_COUNTRIES,
  COUNTRY_CURRENCY_MAP,
  type CurrencyCode,
} from "@/lib/constants/currencies";
import { formatCompactNumber } from "@/lib/utils/formatters";
import { CentralBankSavingsTab } from "./components/CentralBankSavingsTab";
import { CentralBankLoanTab } from "./components/CentralBankLoanTab";
import { CentralBankAdminTab } from "./components/CentralBankAdminTab";
import { CentralBankInterventionTab } from "./components/CentralBankInterventionTab";
import { CentralBankLoadingState } from "./components/CentralBankLoadingState";
import { CentralBankFinancialsTab } from "./components/CentralBankFinancialsTab";
import { CentralBankMoneySupplyTab } from "./components/CentralBankMoneySupplyTab";
import { InflationBreakdownTooltip } from "./components/InflationBreakdownTooltip";
import { ChairCard } from "./components/ChairCard";
import { DismissChairPanel } from "./components/DismissChairPanel";
import { CurrencyRegimePanel } from "./components/CurrencyRegimePanel";
import { PrimeRateCard } from "./components/PrimeRateCard";
import { NominationsPanel } from "./components/NominationsPanel";
import { LobbyingPanel } from "./components/LobbyingPanel";
import { ratingColor } from "./components/centralBankUtils";
import { CentralBankMembersTab, type CentralBankMember } from "./components/CentralBankMembersTab";
import { FomcCommitteeTab } from "./components/FomcCommitteeTab";
import { CentralBankReserveTab } from "./components/CentralBankReserveTab";
import { CentralBankInsuranceTab } from "./components/CentralBankInsuranceTab";
import type { BankData } from "./components/centralBankTypes";

export type { CentralBankMember };

type CentralBankTab =
  | "overview"
  | "committee"
  | "members"
  | "savings"
  | "loc"
  | "balance-sheet"
  | "money-supply"
  | "intervention"
  | "reserves"
  | "insurance"
  | "admin";

const VALID_TABS: CentralBankTab[] = [
  "overview",
  "committee",
  "members",
  "savings",
  "loc",
  "balance-sheet",
  "money-supply",
  "intervention",
  "reserves",
  "insurance",
  "admin",
];

function isValidTab(s: string | null): s is CentralBankTab {
  return s !== null && (VALID_TABS as string[]).includes(s);
}

function TabButton({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-3 py-2.5 text-sm font-medium transition-colors border-b-2 -mb-px ${
        active
          ? "border-primary text-primary"
          : "border-transparent text-muted hover:text-foreground"
      }`}
    >
      {label}
    </button>
  );
}

function displayPreferenceDiffersFromBankHome(
  preference: string,
  viewerHomeCurrency: CurrencyCode,
  bankHomeCurrency: CurrencyCode
): boolean {
  if (preference === "internal") return true;
  if (preference === "local") return false;
  if (preference === "home") return viewerHomeCurrency !== bankHomeCurrency;
  return preference !== bankHomeCurrency;
}

interface Props {
  countryId: CountryId;
  apiBasePath?: string;
  members: CentralBankMember[];
}

export default function CentralBankClient({ countryId, apiBasePath, members }: Props) {
  const config = COUNTRY_CONFIGS[countryId];
  const bankApiBasePath = apiBasePath ?? centralBankApiUrl(countryId);
  const {
    currencyCode: viewerHomeCurrency,
    displayCurrencyPreference,
    formatAmount,
    forexRates,
    toInternalFrom,
  } = useCurrency();
  const [data, setData] = useState<BankData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const tabParam = searchParams.get("tab");
  const activeTab: CentralBankTab = isValidTab(tabParam) ? tabParam : "overview";

  const setActiveTab = (next: CentralBankTab) => {
    const params = new URLSearchParams(searchParams.toString());
    if (next === "overview") {
      params.delete("tab");
    } else {
      params.set("tab", next);
    }
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  };

  const [resignLoading, setResignLoading] = useState(false);
  const [chairDecisionLoading, setChairDecisionLoading] = useState(false);
  const [chairDecisionError, setChairDecisionError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch(bankApiBasePath);
      if (!res.ok) throw new Error("Failed to load central bank data");
      const json = await res.json();
      setData(json);
      setChairDecisionError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, [bankApiBasePath]);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  const handleResign = async () => {
    if (!confirm("Are you sure you want to resign as chair? This cannot be undone.")) return;
    setResignLoading(true);
    try {
      const res = await fetch(`${bankApiBasePath}/resign`, { method: "POST" });
      if (!res.ok) {
        const json = await res.json();
        alert((json as { error?: string }).error || "Failed to resign");
        return;
      }
      await fetchData();
    } catch {
      alert("Failed to resign");
    } finally {
      setResignLoading(false);
    }
  };

  const handleChairAccept = async () => {
    setChairDecisionLoading(true);
    setChairDecisionError(null);
    try {
      const res = await fetch(`${bankApiBasePath}/chair-selection/accept`, { method: "POST" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok)
        throw new Error((json as { error?: string }).error || "Could not accept appointment");
      await fetchData();
    } catch (err) {
      setChairDecisionError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setChairDecisionLoading(false);
    }
  };

  const handleChairDecline = async () => {
    if (
      !confirm(
        "Decline this appointment? Another candidate may be proposed. If none remain eligible, the seat stays vacant."
      )
    )
      return;
    setChairDecisionLoading(true);
    setChairDecisionError(null);
    try {
      const res = await fetch(`${bankApiBasePath}/chair-selection/decline`, { method: "POST" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok)
        throw new Error((json as { error?: string }).error || "Could not decline appointment");
      await fetchData();
    } catch (err) {
      setChairDecisionError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setChairDecisionLoading(false);
    }
  };

  if (loading) return <CentralBankLoadingState countryId={countryId} />;

  if (error || !data) {
    return (
      <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6">
        <div className="rounded-xl border border-error/30 bg-error/10 p-6 text-center">
          <p className="text-sm text-error">{error || "Failed to load data"}</p>
        </div>
      </div>
    );
  }

  const latestGdp =
    data.gdpGrowthHistory.length > 0
      ? data.gdpGrowthHistory[data.gdpGrowthHistory.length - 1].rate
      : 2.0;
  const reserveHeadline = data.balanceSheet
    ? (() => {
        const homeCurrency = data.balanceSheet.homeCurrency;
        const totalHomeValue = data.balanceSheet.reservePortfolio.totalReservesHomeValue;
        const homeValue = formatNativeCurrency(totalHomeValue, homeCurrency);
        const showDisplayPreference =
          displayPreferenceDiffersFromBankHome(
            displayCurrencyPreference,
            viewerHomeCurrency,
            homeCurrency
          ) && !!forexRates;
        if (!showDisplayPreference) return homeValue;
        const internalValue = toInternalFrom(totalHomeValue, homeCurrency);
        const displayValue =
          displayCurrencyPreference === "internal"
            ? `Base ${formatCompactNumber(internalValue)}`
            : formatAmount(internalValue, homeCurrency);
        return `${homeValue} (${displayValue})`;
      })()
    : "-";

  const executiveLabel = config.officeTypes.find((o) => o.isExecutive)?.label ?? "executive";

  return (
    <div className="pb-16">
      <div className="mx-auto max-w-7xl px-4 pt-6 sm:px-6">
        <BackButton
          fallbackLabel={`Back to ${config.name}`}
          fallbackHref={`/country/${countryId.toLowerCase()}`}
        />

        {/* Bank-keyed identity masthead (locked composite): hero photo →
            gradient → identity band → fused tile strip; DE/IE share the ECB
            record via getBankId. */}
        <div className="mt-3 mb-8">
          <InstitutionMasthead
            countryId={countryId}
            identity={getBankIdentity(getBankId(countryId))}
            heroImage={
              config.centralBank.heroImage
                ? {
                    src: config.centralBank.heroImage,
                    alt: config.centralBank.heroAlt || data.bankName,
                  }
                : null
            }
            chips={
              <>
                <MastheadChip>
                  {data.chairTitle}:{" "}
                  {data.chair ? (
                    data.chair.name
                  ) : (
                    <span className="italic text-white/60">Vacant</span>
                  )}
                </MastheadChip>
                {data.chairTermExpiresAtTurn != null && data.chair && (
                  <MastheadChip tone="mono">term to T {data.chairTermExpiresAtTurn}</MastheadChip>
                )}
                {data.intervention && FOREX_ACTIVE_COUNTRIES.includes(countryId) && (
                  <MastheadChip tone="warning">FOREX intervention active</MastheadChip>
                )}
              </>
            }
            rightSlot={
              <MastheadStat
                label="Prime Rate"
                value={`${(data.primeRate ?? 0).toFixed(2)}%`}
                accentSoft={getBankIdentity(getBankId(countryId)).accentSoft}
              />
            }
            strip={
              <div className="grid grid-cols-2 gap-px border-t border-card-border bg-card-border sm:grid-cols-3">
                <div className="bg-card px-4 py-3">
                  <InfoTooltip
                    trigger={
                      <span className="flex cursor-help items-center gap-1 text-[9px] font-semibold uppercase tracking-widest text-muted">
                        Inflation
                        <svg
                          className="h-3 w-3 text-muted/60"
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
                      </span>
                    }
                    width={280}
                  >
                    <InflationBreakdownTooltip
                      breakdown={data.inflationBreakdown}
                      total={data.inflationBreakdownTotal ?? data.currentInflation ?? 0}
                      effectiveRate={data.effectiveRate}
                    />
                  </InfoTooltip>
                  <span
                    className={`mt-1 block font-mono text-base font-bold tabular-nums ${
                      (data.currentInflation ?? 0) > 4
                        ? "text-error"
                        : (data.currentInflation ?? 0) > 3
                          ? "text-warning"
                          : "text-success"
                    }`}
                  >
                    {(data.currentInflation ?? 0).toFixed(2)}%
                  </span>
                </div>
                <div className="bg-card px-4 py-3">
                  <InfoTooltip
                    trigger={
                      <span className="flex cursor-help items-center gap-1 text-[9px] font-semibold uppercase tracking-widest text-muted">
                        Savings Flow
                        <svg
                          className="h-3 w-3 text-muted/60"
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
                      </span>
                    }
                    width={280}
                  >
                    <div className="space-y-2">
                      <p className="font-semibold text-foreground">What is Savings Flow?</p>
                      <p className="text-muted leading-relaxed">
                        Tracks whether households are spending their savings or stashing more away,
                        as net flows over recent turns versus total savings stock - not the same as
                        a national accounting &quot;savings rate&quot; (% of GDP). It&apos;s one
                        input to inflation.
                      </p>
                      <ul className="space-y-1 text-muted">
                        <li>
                          <span className="text-error font-semibold">Positive (+)</span> - people
                          are pulling money out of savings to spend. Extra demand pushes prices up
                          (inflationary).
                        </li>
                        <li>
                          <span className="text-success font-semibold">Negative (−)</span> - people
                          are saving more than spending. Less demand eases prices (slightly
                          deflationary).
                        </li>
                        <li>
                          <span className="font-semibold">Near zero</span> - spending and saving are
                          roughly balanced.
                        </li>
                      </ul>
                      <p className="text-muted leading-relaxed">
                        Higher interest rates encourage saving; lower rates encourage spending.
                        Chairs move the prime rate to nudge this number.
                      </p>
                    </div>
                  </InfoTooltip>
                  <span
                    className={`mt-1 block font-mono text-base font-bold tabular-nums ${
                      data.currentSavingsPressure > 0.5
                        ? "text-error"
                        : data.currentSavingsPressure < -0.5
                          ? "text-success"
                          : "text-foreground"
                    }`}
                  >
                    {(data.currentSavingsPressure ?? 0) >= 0 ? "+" : ""}
                    {(data.currentSavingsPressure ?? 0).toFixed(2)}%
                  </span>
                </div>
                <div className="col-span-2 bg-card px-4 py-3 sm:col-span-1">
                  <span className="text-[9px] font-semibold uppercase tracking-widest text-muted">
                    Reserves
                  </span>
                  <span className="mt-1 block font-mono text-base font-bold tabular-nums">
                    {reserveHeadline}
                  </span>
                </div>
              </div>
            }
          />
          {data.isChair && data.chairMode !== "npp" && (
            <div className="mt-3 flex justify-end">
              <button
                onClick={handleResign}
                disabled={resignLoading}
                className="rounded-lg border border-error/40 bg-error/10 px-3 py-1.5 text-xs font-semibold text-error hover:bg-error/20 transition-colors disabled:opacity-50"
              >
                {resignLoading ? "Resigning..." : `Resign as ${data.chairTitle}`}
              </button>
            </div>
          )}
        </div>
      </div>

      <div className="mx-auto max-w-7xl px-4 sm:px-6">
        <div className="flex flex-wrap items-center gap-x-1 gap-y-0 border-b border-card-border mb-6">
          <TabButton
            active={activeTab === "overview"}
            onClick={() => setActiveTab("overview")}
            label="Overview"
          />
          {!data.governmentControlled && (
            <TabButton
              active={activeTab === "committee"}
              onClick={() => setActiveTab("committee")}
              label="FOMC"
            />
          )}
          <TabButton
            active={activeTab === "members"}
            onClick={() => setActiveTab("members")}
            label="Members"
          />
          {FOREX_ACTIVE_COUNTRIES.includes(countryId) && (
            <TabButton
              active={activeTab === "savings"}
              onClick={() => setActiveTab("savings")}
              label="Savings"
            />
          )}
          {FOREX_ACTIVE_COUNTRIES.includes(countryId) && data.lineOfCreditEnabled && (
            <TabButton
              active={activeTab === "loc"}
              onClick={() => setActiveTab("loc")}
              label="Line of Credit"
            />
          )}
          {data.balanceSheet && (
            <TabButton
              active={activeTab === "balance-sheet"}
              onClick={() => setActiveTab("balance-sheet")}
              label="Bank Financials"
            />
          )}
          {data.moneySupply && (
            <TabButton
              active={activeTab === "money-supply"}
              onClick={() => setActiveTab("money-supply")}
              label="Money Supply"
            />
          )}
          {FOREX_ACTIVE_COUNTRIES.includes(countryId) && data.intervention && (
            <TabButton
              active={activeTab === "intervention"}
              onClick={() => setActiveTab("intervention")}
              label="FX Intervention"
            />
          )}
          <TabButton
            active={activeTab === "reserves"}
            onClick={() => setActiveTab("reserves")}
            label="Reserves"
          />
          <TabButton
            active={activeTab === "insurance"}
            onClick={() => setActiveTab("insurance")}
            label="Insurance"
          />
          {data.isAdmin && (
            <TabButton
              active={activeTab === "admin"}
              onClick={() => setActiveTab("admin")}
              label="Admin"
            />
          )}
        </div>
      </div>

      {activeTab === "committee" && !data.governmentControlled && (
        <div className="mx-auto max-w-7xl px-4 sm:px-6">
          <FomcCommitteeTab countryId={countryId} />
        </div>
      )}

      {activeTab === "members" && (
        <div className="mx-auto max-w-7xl px-4 sm:px-6">
          <CentralBankMembersTab members={members} />
        </div>
      )}
      {activeTab === "savings" && (
        <div className="mx-auto max-w-7xl px-4 sm:px-6">
          <CentralBankSavingsTab countryId={countryId} />
        </div>
      )}
      {activeTab === "loc" && (
        <div className="mx-auto max-w-7xl px-4 sm:px-6">
          <CentralBankLoanTab countryId={countryId} />
        </div>
      )}
      {activeTab === "balance-sheet" && data.balanceSheet && (
        <div className="mx-auto max-w-7xl px-4 sm:px-6">
          <CentralBankFinancialsTab
            countryId={countryId}
            balanceSheet={data.balanceSheet}
            bankFinancials={data.bankFinancials ?? null}
            isChair={data.isChair === true}
            isAdmin={data.isAdmin === true}
            chairControlsLocked={data.chairControlsLocked === true}
            onChanged={fetchData}
          />
        </div>
      )}
      {activeTab === "money-supply" && data.moneySupply && (
        <div className="mx-auto max-w-7xl px-4 sm:px-6">
          <CentralBankMoneySupplyTab
            countryId={countryId}
            data={data.moneySupply}
            canOperate={
              data.isAdmin === true || (data.isChair === true && data.chairControlsLocked !== true)
            }
            onChanged={fetchData}
          />
        </div>
      )}
      {activeTab === "intervention" && data.intervention && (
        <div className="mx-auto max-w-7xl space-y-6 px-4 sm:px-6">
          <CurrencyRegimePanel
            bankApiBasePath={bankApiBasePath}
            isChair={data.isChair === true}
            currentTurn={data.currentTurn ?? 0}
            onChanged={fetchData}
          />
          <CentralBankInterventionTab
            countryId={countryId}
            data={data.intervention}
            isChair={data.isChair === true}
            isAdmin={data.isAdmin === true}
            chairControlsLocked={data.chairControlsLocked === true}
            currentTurn={data.currentTurn ?? 0}
            onChanged={fetchData}
          />
        </div>
      )}
      {activeTab === "reserves" && (
        <div className="mx-auto max-w-7xl px-4 sm:px-6">
          <CentralBankReserveTab currency={COUNTRY_CURRENCY_MAP[countryId]} />
        </div>
      )}
      {activeTab === "insurance" && (
        <div className="mx-auto max-w-7xl px-4 sm:px-6">
          <CentralBankInsuranceTab currency={COUNTRY_CURRENCY_MAP[countryId]} />
        </div>
      )}
      {activeTab === "admin" && data.isAdmin && (
        <div className="mx-auto max-w-7xl px-4 sm:px-6">
          <CentralBankAdminTab countryId={countryId} />
        </div>
      )}

      {activeTab === "overview" && (
        <div className="mx-auto max-w-7xl px-4 sm:px-6">
          {/* Do not gate on chairMode !== "npp": persistPendingProposal leaves
              chairMode npp on the caretaker, which hid this banner on every
              live Fed/BoE/etc. offer (ticket #1144). */}
          {data.pendingChairRequiresMyResponse && (
            <div className="mb-6 rounded-xl border border-primary/35 bg-primary/10 px-4 py-4 sm:px-5">
              <p className="text-sm font-semibold text-foreground">
                You have been selected as the next {data.chairTitle}
              </p>
              <p className="mt-1 text-xs text-muted">
                {data.chairSelectionPending?.pool === "economic"
                  ? "You were drawn from the market candidates pool. Accept to take office, or decline to pass to the next wealthiest eligible candidate."
                  : "You were drawn from the executive nominations pool. Accept to take office, or decline to allow another candidate to be proposed."}
              </p>
              {chairDecisionError && (
                <p className="mt-2 text-xs text-error">{chairDecisionError}</p>
              )}
              <div className="mt-3 flex flex-wrap gap-2">
                <Button
                  variant="primary"
                  onClick={handleChairAccept}
                  disabled={chairDecisionLoading}
                >
                  {chairDecisionLoading ? "Working..." : "Accept appointment"}
                </Button>
                <Button
                  variant="ghost"
                  onClick={handleChairDecline}
                  disabled={chairDecisionLoading}
                >
                  Decline
                </Button>
              </div>
            </div>
          )}

          <div className="grid min-w-0 gap-6 lg:grid-cols-3">
            <div className="min-w-0 space-y-6 lg:col-span-1">
              <ChairCard
                chairTitle={data.chairTitle}
                chair={data.chair}
                chairAppointedAt={data.chairAppointedAt}
                chairInfamy={data.chairInfamy}
                resolveStreak={data.resolveStreak}
                chairTermExpiresAtTurn={data.chairTermExpiresAtTurn}
                currentTurn={data.currentTurn}
                currentInflation={data.currentInflation}
                targetInflation={data.targetInflation}
                latestGdp={latestGdp}
                chairSelectionPending={data.chairSelectionPending}
                viewerIsChairNominee={data.viewerIsChairNominee ?? false}
                countryCode={data.countryId || countryId}
                chairMode={data.chairMode}
              />
              {data.isExecutive && data.chair && data.chairMode !== "npp" && (
                <DismissChairPanel
                  chairTitle={data.chairTitle}
                  chairName={data.chair.name}
                  bankApiBasePath={bankApiBasePath}
                  onChanged={fetchData}
                />
              )}
              <PrimeRateCard
                primeRate={data.primeRate}
                isChair={data.isChair}
                chairControlsLocked={data.chairControlsLocked ?? false}
                governmentControlled={data.governmentControlled ?? false}
                viewerSetsRate={data.viewerSetsRate ?? false}
                committeeSeated={data.committeeSeated ?? false}
                onOpenCommittee={() => setActiveTab("committee")}
                lastRateChangeTurn={data.lastRateChangeTurn}
                currentTurn={data.currentTurn}
                bankApiBasePath={bankApiBasePath}
                onChanged={fetchData}
              />
              <NominationsPanel
                nominations={data.nominations}
                nominationWindowOpen={data.nominationWindowOpen}
                isExecutive={data.isExecutive}
                chairTermExpiresAtTurn={data.chairTermExpiresAtTurn}
                currentTurn={data.currentTurn}
                bankApiBasePath={bankApiBasePath}
                onChanged={fetchData}
                executiveLabel={executiveLabel}
              />
            </div>

            <div className="min-w-0 space-y-6 lg:col-span-2">
              {/* Rate corridor (locked composite signature) - replaces the
                  standalone inflation card; breakdown stays on the strip tile. */}
              <RateCorridor
                interestRateHistory={data.interestRateHistory}
                inflationHistory={data.inflationHistory}
                primeRate={data.primeRate ?? 0}
                currentInflation={data.currentInflation ?? 0}
              />

              <div className="rounded-xl border border-card-border bg-card p-5">
                <h2 className="mb-4 text-xs font-semibold uppercase tracking-widest text-muted">
                  Economic Trends
                </h2>
                <EconomicTrendsChart
                  interestRateHistory={data.interestRateHistory}
                  inflationHistory={data.inflationHistory}
                  gdpGrowthHistory={data.gdpGrowthHistory}
                  savingsFlowHistory={data.savingsFlowHistory}
                />
              </div>

              <div className="rounded-xl border border-card-border bg-card p-5">
                <h2 className="mb-4 text-xs font-semibold uppercase tracking-widest text-muted">
                  Credit Rating Scale
                </h2>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-card-border text-left">
                        <th className="pb-2 pr-4 text-xs font-semibold uppercase tracking-wider text-muted">
                          Rating
                        </th>
                        <th className="pb-2 pr-4 text-xs font-semibold uppercase tracking-wider text-muted">
                          Spread
                        </th>
                        <th className="pb-2 text-xs font-semibold uppercase tracking-wider text-muted">
                          Effective Rate
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {CREDIT_RATINGS.map((rating) => (
                        <tr key={rating} className="border-b border-card-border/50 last:border-0">
                          <td className="py-2.5 pr-4">
                            <span
                              className={`inline-block rounded px-2 py-0.5 text-xs font-bold ${ratingColor(rating)}`}
                            >
                              {rating}
                            </span>
                          </td>
                          <td className="py-2.5 pr-4 text-muted">
                            +{((data.rateScale[rating] ?? 0) - (data.primeRate ?? 0)).toFixed(2)}%
                          </td>
                          <td className="py-2.5 font-semibold text-foreground">
                            {(data.rateScale[rating] ?? 0).toFixed(2)}%
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </div>

          <LobbyingPanel
            lobbyingTotals={data.lobbyingTotals}
            nominations={data.nominations}
            nationalCurrency={data.nationalCurrency ?? "USD"}
            userLobbyLiquid={data.userLobbyLiquid ?? 0}
            userHomeCurrency={data.userHomeCurrency ?? "USD"}
            userHomeLiquid={data.userHomeLiquid ?? 0}
            countryId={countryId}
            bankApiBasePath={bankApiBasePath}
            onChanged={fetchData}
          />
        </div>
      )}
    </div>
  );
}
