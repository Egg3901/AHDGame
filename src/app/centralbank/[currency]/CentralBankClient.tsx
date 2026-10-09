"use client";

import { useGameEvents } from "@/hooks/useGameEvents";

import { MonetaryAuthorityNotice } from "./components/MonetaryAuthorityNotice";

import { useState, useEffect, useCallback } from "react";
import { useSearchParams, useRouter, usePathname } from "next/navigation";
import { InfoTooltip } from "@/components/InfoTooltip";
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
  FOREX_ACTIVE_CURRENCIES,
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
import { CentralBankMembersTab, type CentralBankMember } from "./components/CentralBankMembersTab";
import { FomcCommitteeTab } from "./components/FomcCommitteeTab";
import { CentralBankReserveTab } from "./components/CentralBankReserveTab";
import { CentralBankInsuranceTab } from "./components/CentralBankInsuranceTab";
import type { BankData } from "./components/centralBankTypes";
import { CentralBankHeader } from "./components/CentralBankHeader";
import { CB_TH, CentralBankFigure, CentralBankSection } from "./components/CentralBankSection";

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

function InfoIcon() {
  return (
    <svg
      className="h-3.5 w-3.5 text-muted"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      aria-hidden
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
      />
    </svg>
  );
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
      setError(null);
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

  useGameEvents(() => void fetchData(), ["turn_complete", "market_tick"]);

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
          <p className="text-body text-error">{error || "Failed to load data"}</p>
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
  const inflation = data.currentInflation ?? 0;
  const savingsFlow = data.currentSavingsPressure ?? 0;

  return (
    <div className="pb-16">
      <div className="mx-auto max-w-7xl px-4 pt-6 sm:px-6">
        <BackButton
          fallbackLabel={`Back to ${config.name}`}
          fallbackHref={`/country/${countryId.toLowerCase()}`}
        />

        {/* Bank-keyed identity (DE/IE share the ECB record via getBankId). */}
        <div className="mb-8 mt-3">
          <CentralBankHeader
            identity={getBankIdentity(getBankId(countryId))}
            heroImage={
              config.centralBank.heroImage
                ? {
                    src: config.centralBank.heroImage,
                    alt: config.centralBank.heroAlt || data.bankName,
                  }
                : null
            }
            details={
              <>
                <span>
                  <span className="text-muted">{data.chairTitle}:</span>{" "}
                  {data.chair ? (
                    <span className="font-medium">{data.chair.name}</span>
                  ) : (
                    <span className="text-muted">Vacant</span>
                  )}
                </span>
                {data.chairTermExpiresAtTurn != null && data.chair && (
                  <span className="text-muted">
                    · Term ends on turn {data.chairTermExpiresAtTurn}
                  </span>
                )}
                {data.intervention &&
                  FOREX_ACTIVE_CURRENCIES.includes(data.nationalCurrency ?? "USD") && (
                    <span className="text-muted">· FX intervention active</span>
                  )}
              </>
            }
            primeRate={`${(data.primeRate ?? 0).toFixed(2)}%`}
            figures={
              <>
                <CentralBankFigure
                  label={
                    <InfoTooltip
                      trigger={
                        <span className="inline-flex cursor-help items-center gap-1">
                          Inflation
                          <InfoIcon />
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
                  }
                  value={`${inflation.toFixed(2)}%`}
                  valueClassName={
                    inflation > 4
                      ? "text-error"
                      : inflation > 3
                        ? "text-warning"
                        : "text-foreground"
                  }
                />
                <CentralBankFigure
                  label={
                    <InfoTooltip
                      trigger={
                        <span className="inline-flex cursor-help items-center gap-1">
                          Savings flow
                          <InfoIcon />
                        </span>
                      }
                      width={280}
                    >
                      <div className="space-y-2">
                        <p className="font-semibold text-foreground">What is savings flow?</p>
                        <p className="leading-relaxed text-muted">
                          Tracks whether households are spending their savings or putting more away,
                          as net flows over recent turns against total savings. It is not the same
                          as a national &quot;savings rate&quot; (% of GDP). It is one input to
                          inflation.
                        </p>
                        <ul className="space-y-1 text-muted">
                          <li>
                            <span className="font-semibold text-foreground">Positive (+):</span>{" "}
                            people are pulling money out of savings to spend. Extra demand pushes
                            prices up.
                          </li>
                          <li>
                            <span className="font-semibold text-foreground">Negative (-):</span>{" "}
                            people are saving more than they spend. Less demand eases prices
                            slightly.
                          </li>
                          <li>
                            <span className="font-semibold text-foreground">Near zero:</span>{" "}
                            spending and saving are roughly balanced.
                          </li>
                        </ul>
                        <p className="leading-relaxed text-muted">
                          Higher interest rates encourage saving; lower rates encourage spending.
                          Chairs move the prime rate to nudge this number.
                        </p>
                      </div>
                    </InfoTooltip>
                  }
                  value={`${savingsFlow >= 0 ? "+" : ""}${savingsFlow.toFixed(2)}%`}
                  valueClassName={savingsFlow > 0.5 ? "text-error" : "text-foreground"}
                />
                <div className="col-span-2 sm:col-span-1">
                  <CentralBankFigure label="Reserves" value={reserveHeadline} />
                </div>
              </>
            }
          />
          {data.isChair && data.chairMode !== "npp" && (
            <div className="mt-3 flex justify-end">
              <button
                onClick={handleResign}
                disabled={resignLoading}
                className="rounded-md border border-error/40 px-3 py-1.5 text-body-sm font-semibold text-error transition-colors hover:bg-error/10 disabled:opacity-50"
              >
                {resignLoading ? "Resigning..." : `Resign as ${data.chairTitle}`}
              </button>
            </div>
          )}
        </div>
      </div>

      <div className="mx-auto max-w-7xl px-4 sm:px-6">
        <div className="mb-8 flex flex-wrap items-center gap-x-1 gap-y-0 border-b border-card-border">
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
          {FOREX_ACTIVE_CURRENCIES.includes(data.nationalCurrency ?? "USD") && (
            <TabButton
              active={activeTab === "savings"}
              onClick={() => setActiveTab("savings")}
              label="Savings"
            />
          )}
          {FOREX_ACTIVE_CURRENCIES.includes(data.nationalCurrency ?? "USD") &&
            data.lineOfCreditEnabled && (
              <TabButton
                active={activeTab === "loc"}
                onClick={() => setActiveTab("loc")}
                label="Line of credit"
              />
            )}
          {data.balanceSheet && (
            <TabButton
              active={activeTab === "balance-sheet"}
              onClick={() => setActiveTab("balance-sheet")}
              label="Bank financials"
            />
          )}
          {data.moneySupply && (
            <TabButton
              active={activeTab === "money-supply"}
              onClick={() => setActiveTab("money-supply")}
              label="Money supply"
            />
          )}
          {FOREX_ACTIVE_CURRENCIES.includes(data.nationalCurrency ?? "USD") &&
            data.intervention && (
              <TabButton
                active={activeTab === "intervention"}
                onClick={() => setActiveTab("intervention")}
                label="FX intervention"
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
              data.isAdmin === true ||
              ((data.isPolicyChair ?? data.isChair) === true &&
                (data.policyChairControlsLocked ?? data.chairControlsLocked) !== true)
            }
            onChanged={fetchData}
          />
        </div>
      )}
      {activeTab === "intervention" && data.intervention && (
        <div className="mx-auto max-w-7xl space-y-12 px-4 sm:px-6">
          <CurrencyRegimePanel
            bankApiBasePath={bankApiBasePath}
            isChair={(data.isPolicyChair ?? data.isChair) === true}
            currentTurn={data.currentTurn ?? 0}
            onChanged={fetchData}
          />
          <CentralBankInterventionTab
            countryId={countryId}
            data={data.intervention}
            isChair={(data.isPolicyChair ?? data.isChair) === true}
            isAdmin={data.isAdmin === true}
            chairControlsLocked={
              (data.policyChairControlsLocked ?? data.chairControlsLocked) === true
            }
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
            <div className="mb-10 rounded-xl border border-primary/35 bg-primary/10 px-4 py-4 sm:px-5">
              <p className="text-body font-semibold text-foreground">
                You have been selected as the next {data.chairTitle}
              </p>
              <p className="mt-1 text-body-sm text-muted">
                {data.chairSelectionPending?.pool === "economic"
                  ? "You were drawn from the market candidates pool. Accept to take office, or decline to pass to the next wealthiest eligible candidate."
                  : "You were drawn from the executive nominations pool. Accept to take office, or decline to allow another candidate to be proposed."}
              </p>
              {chairDecisionError && (
                <p className="mt-2 text-body-sm text-error">{chairDecisionError}</p>
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

          <div className="grid min-w-0 gap-x-12 gap-y-12 lg:grid-cols-3">
            {/* Aside: who runs the bank, the rate and its controls, and the
                nominations for the next chair. */}
            <div className="min-w-0 space-y-10 lg:col-span-1">
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
              {data.monetaryAuthority && data.monetaryAuthority.countryId !== countryId && (
                <MonetaryAuthorityNotice name={data.monetaryAuthority.name} />
              )}
              <PrimeRateCard
                primeRate={data.primeRate}
                isChair={data.isPolicyChair ?? data.isChair}
                chairControlsLocked={
                  data.policyChairControlsLocked ?? data.chairControlsLocked ?? false
                }
                governmentControlled={data.governmentControlled ?? false}
                viewerSetsRate={data.viewerSetsRate ?? false}
                committeeSeated={data.committeeSeated ?? false}
                committeeDead={data.committeeDead ?? false}
                onOpenCommittee={() => setActiveTab("committee")}
                inflationRate={data.rateInflation}
                targetInflation={data.rateTargetInflation}
                lastRateChangeTurn={data.lastRateChangeTurn}
                currentTurn={data.currentTurn}
                bankApiBasePath={bankApiBasePath}
                onChanged={fetchData}
                governanceEndpoint={
                  data.committeeSeated || data.committeeDead
                    ? `/api/country/${countryId.toLowerCase()}/fomc`
                    : undefined
                }
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

            {/* Main column: the rate against inflation, the longer trends,
                what each credit rating pays, and the race for the next chair. */}
            <div className="min-w-0 space-y-12 lg:col-span-2">
              <RateCorridor
                interestRateHistory={data.interestRateHistory}
                inflationHistory={data.inflationHistory}
                primeRate={data.primeRate ?? 0}
                currentInflation={data.currentInflation ?? 0}
                neutralPrimeRate={data.neutralPrimeRate}
                isSharedPolicyArea={data.isSharedPolicyArea ?? false}
              />

              <CentralBankSection title="Economic trends">
                <EconomicTrendsChart
                  interestRateHistory={data.interestRateHistory}
                  inflationHistory={data.inflationHistory}
                  gdpGrowthHistory={data.gdpGrowthHistory}
                  savingsFlowHistory={data.savingsFlowHistory}
                />
              </CentralBankSection>

              <CentralBankSection
                title="Credit rating scale"
                meta="What a borrower with each rating pays over the prime rate."
              >
                <div className="overflow-x-auto">
                  <table className="w-full text-body">
                    <thead>
                      <tr>
                        <th scope="col" className={CB_TH}>
                          Rating
                        </th>
                        <th scope="col" className={`${CB_TH} text-right`}>
                          Spread
                        </th>
                        <th scope="col" className={`${CB_TH} text-right`}>
                          Effective rate
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {CREDIT_RATINGS.map((rating) => (
                        <tr key={rating} className="border-b border-card-border/60 last:border-0">
                          <td className="py-2.5 pr-4 font-semibold text-foreground">{rating}</td>
                          <td className="py-2.5 pr-4 text-right font-mono tabular-nums text-muted">
                            +{((data.rateScale[rating] ?? 0) - (data.primeRate ?? 0)).toFixed(2)}%
                          </td>
                          <td className="py-2.5 pr-4 text-right font-mono font-semibold tabular-nums text-foreground">
                            {(data.rateScale[rating] ?? 0).toFixed(2)}%
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CentralBankSection>

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
          </div>
        </div>
      )}
    </div>
  );
}
