"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import BackButton from "@/components/BackButton";
import { Skeleton } from "@/components/ui";
import { useCurrency } from "@/contexts/CurrencyContext";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { COUNTRY_CURRENCY_MAP } from "@/lib/constants/currencies";
import { getEconomyIdentity } from "@/lib/constants/economyIdentity";
import { deriveEconomicOutlook } from "@/lib/economy/outlook";
import type { CountryEconomyOutlook } from "@/lib/economy/queries/countryEconomyOutlook";
import { formatCurrencyCompactChip } from "@/lib/utils/formatters";
import { getCurrencyPrefix } from "@/lib/utils/budgetCalculations";
import { EconomyMasthead } from "@/components/economy/EconomyMasthead";
import { PulseStrip } from "@/components/economy/PulseStrip";
import { NationalSectorBoard } from "@/components/economy/NationalSectorBoard";
import { RealEconomyPanel } from "@/components/economy/RealEconomyPanel";
import { MarketsStrip } from "@/components/economy/MarketsStrip";
import { PlannedEconomyPanel } from "@/components/economy/PlannedEconomyPanel";

/**
 * National Economic Outlook page client — masthead with verdict seal and the
 * pulse strip (Phase 2 shell). The sector-mix board, real-economy rows, and
 * markets strip land in Phase 3 beneath the masthead.
 */
export function EconomyOutlookClient() {
  const { code } = useParams<{ code: string }>();
  const countryParam = (code ?? "us").toUpperCase();
  const countryId: CountryId =
    countryParam in COUNTRY_CONFIGS ? (countryParam as CountryId) : COUNTRY_CONFIGS.US.id;

  const [fetchState, setFetchState] = useState<{
    status: "loading" | "error" | "ready";
    data: CountryEconomyOutlook | null;
  }>({ status: "loading", data: null });

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/country/${countryId.toLowerCase()}/economy`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`${r.status}`))))
      .then((d) => {
        if (!cancelled) setFetchState({ status: "ready", data: d });
      })
      .catch(() => {
        if (!cancelled) setFetchState({ status: "error", data: null });
      });
    return () => {
      cancelled = true;
    };
  }, [countryId]);

  const { status, data } = fetchState;
  const loading = status === "loading";
  const error = status === "error";

  const { formatAmountChipIn } = useCurrency();
  // Market sizes anchor on the country's home currency, mirroring the state
  // Economy tab's rationale: the national market is an economy-anchored
  // quantity, not a wallet-anchored one.
  const homeCurrency = COUNTRY_CURRENCY_MAP[countryId] ?? "USD";
  const prefix = getCurrencyPrefix(countryId);

  const identity = getEconomyIdentity(countryId);
  const config = COUNTRY_CONFIGS[countryId];
  const outlook = data
    ? deriveEconomicOutlook({
        gdpGrowth: data.pulse.gdpGrowth.value,
        inflation: data.pulse.inflation.value,
        inflationTarget: data.pulse.inflation.target,
        unemploymentTrend: data.realEconomy.unemployment.trend,
      })
    : null;

  return (
    <div className="min-h-screen bg-background pb-16">
      <main className="mx-auto max-w-7xl min-w-0 space-y-6 px-4 py-8 sm:px-8 sm:py-12 lg:px-12">
        <BackButton />

        {loading ? (
          <div className="space-y-4">
            <Skeleton className="h-48 w-full rounded-2xl" />
            <Skeleton className="h-28 w-full rounded-xl" />
          </div>
        ) : error || !data ? (
          <div className="rounded-xl border border-card-border bg-card p-8 text-center text-sm text-muted">
            Failed to load the economic outlook.
          </div>
        ) : (
          <>
            <EconomyMasthead
              countryId={countryId}
              identity={identity}
              currentTurn={data.currentTurn}
              verdict={outlook?.verdict ?? null}
              reasoning={outlook?.reasoning ?? null}
              strip={<PulseStrip countryId={countryId} pulse={data.pulse} />}
            />

            <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-12">
              <div className="flex flex-col gap-4 lg:col-span-5">
                <RealEconomyPanel
                  countryId={countryId}
                  realEconomy={data.realEconomy}
                  gdpPerCapita={data.pulse.gdpPerCapita}
                  formatIncome={(v) => formatCurrencyCompactChip(v, prefix)}
                />
                {data.plannedEconomy && (
                  <PlannedEconomyPanel
                    countryId={countryId}
                    currentYear={data.currentYear}
                    commandEconomyEnabled={data.commandEconomyEnabled}
                    factors={{
                      monetaryOverhang: data.plannedEconomy.monetaryOverhang,
                      shortageIndex: data.plannedEconomy.shortageIndex,
                      blackMarketPremium: data.plannedEconomy.blackMarketPremium,
                      secondEconomyShare: data.plannedEconomy.secondEconomyShare,
                    }}
                  />
                )}
                <MarketsStrip countryId={countryId} markets={data.markets} />
                {data.stateOwnership.status.tier !== "none" && (
                  <div className="rounded-xl border border-card-border bg-card px-5 py-4 shadow-sm">
                    <div className="flex items-baseline justify-between gap-3">
                      <h3 className="text-sm font-bold text-foreground">State Ownership</h3>
                      <span
                        className={`text-lg font-bold tabular-nums ${
                          data.stateOwnership.status.tier === "high"
                            ? "text-error"
                            : data.stateOwnership.status.tier === "elevated"
                              ? "text-warning"
                              : "text-foreground"
                        }`}
                      >
                        {Math.round(data.stateOwnership.concentration)}%
                      </span>
                    </div>
                    <div className="mt-1 text-[11px] font-semibold text-muted">
                      {data.stateOwnership.status.label} concentration of corporate revenue
                    </div>
                    <p className="mt-2 text-[11px] leading-snug text-muted">
                      {data.stateOwnership.status.note}
                    </p>
                  </div>
                )}
              </div>
              <div className="rounded-xl border border-card-border bg-card px-5 py-4 shadow-sm lg:col-span-7">
                <div className="flex items-baseline justify-between gap-3">
                  <h3 className="text-sm font-bold text-foreground">
                    Sector Mix <span className="font-normal text-muted">· national</span>
                  </h3>
                  <span className="text-[10px] text-muted">
                    aggregated across {config.regionLabelPlural.toLowerCase()} · tile links to
                    largest market
                  </span>
                </div>
                <div className="mt-3">
                  <NationalSectorBoard
                    countryId={countryId}
                    sectorMix={data.sectorMix}
                    formatMarket={(v) => formatAmountChipIn(v, homeCurrency)}
                  />
                </div>
              </div>
            </div>
          </>
        )}
      </main>
    </div>
  );
}
