"use client";

import type { LucideIcon } from "lucide-react";
import { useState } from "react";
import {
  Activity,
  Banknote,
  BarChart2,
  Building2,
  CalendarClock,
  Gauge,
  LayoutList,
  MapPinned,
  Pickaxe,
  Scale,
  Users,
  Vote,
  Wallet,
} from "lucide-react";
import { COMMODITY_LABELS } from "@/lib/constants/commodities";
import { COUNTRY_CONFIGS } from "@/lib/constants/countries";
import { CORPORATION_TYPES } from "@/lib/constants/corporations";
import {
  SectorSpecialtyPanel,
  SectorSpecialtySummaryChips,
} from "@/components/wiki/widgets/StartingStateSectorSpecialties";
import type { PartySeed } from "@/lib/seeds/reference/politicalParties";
import {
  STARTING_STATE_1991_COUNTRIES,
  STARTING_STATE_1991_UNSEEDED_COUNTRIES,
  type ScenarioChamber,
  type ScenarioCountry,
} from "@/lib/seeds/wiki/startingStateScenarios";
import {
  type StartingCountryId,
  type CountryStartingStateCopy,
  COUNTRY_ORDER,
  COUNTRY_COPY,
  PARTY_SEEDS_BY_COUNTRY,
  REGIONS_BY_COUNTRY,
  STARTING_ECONOMY_BY_COUNTRY,
  formatMoney,
  formatCompactCurrency,
  formatCompactNumber,
  formatPercent,
  formatPointPercent,
  formatResourceCapacity,
  formatSigned,
  ideologyLabel,
  formatPartyCreationRule,
  getGovernmentOpening,
  getDebtToGdp,
  getDebtHeadroom,
  getTopRegion,
  getResourceSummary,
  getPartyPositionStyle,
} from "@/components/wiki/widgets/StartingStateDashboardData";
import { useCountryDisplayName } from "@/contexts/RegisteredCountriesContext";

function MetricCard({
  icon: Icon,
  label,
  value,
  detail,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <div className="rounded-lg border border-card-border bg-card/45 p-4">
      <div className="mb-3 flex h-9 w-9 items-center justify-center rounded-md border border-card-border bg-card-elevated text-primary">
        <Icon className="h-4 w-4" aria-hidden="true" />
      </div>
      <div className="text-2xl font-semibold leading-none text-foreground">{value}</div>
      <div className="mt-2 text-xs font-semibold uppercase tracking-[0.12em] text-muted">
        {label}
      </div>
      <p className="mt-2 text-sm leading-relaxed text-muted">{detail}</p>
    </div>
  );
}

function MiniMetric({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return (
    <div className="rounded-md border border-card-border bg-card-elevated/55 p-3">
      <div className="text-[11px] font-semibold uppercase tracking-[0.1em] text-muted">{label}</div>
      <div className="mt-1 text-lg font-semibold leading-tight text-foreground">{value}</div>
      {detail && <p className="mt-1 text-xs leading-relaxed text-muted">{detail}</p>}
    </div>
  );
}

function StartingMetricsMatrix({ countries }: { countries: CountryStartingStateCopy[] }) {
  const resolveCountryName = useCountryDisplayName();
  return (
    <section id="starting-metrics" className="scroll-mt-24 space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-primary">
            Macro Snapshot
          </p>
          <h3 className="mt-1 text-xl font-semibold text-foreground">
            Economy, debt, and resource posture
          </h3>
        </div>
        <a
          href="#country-index"
          className="rounded-md border border-card-border bg-card/45 px-3 py-2 text-xs font-medium text-muted transition-colors hover:border-primary/50 hover:text-primary"
        >
          Country index
        </a>
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        {countries.map((country) => {
          const economy = STARTING_ECONOMY_BY_COUNTRY[country.id];
          const resources = getResourceSummary(country.id);
          const topRegion = getTopRegion(country.id);
          const topResource = resources.topResources[0];

          return (
            <a
              key={country.id}
              href={`#starting-state-${country.id.toLowerCase()}-metrics`}
              className="group rounded-lg border border-card-border bg-card/45 p-4 transition-colors hover:border-primary/50 hover:bg-card/70"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="rounded-md border border-card-border bg-card-elevated px-2.5 py-1 font-mono text-xs font-semibold text-primary">
                    {country.shortName}
                  </span>
                  <span className="text-sm font-semibold text-foreground">
                    {resolveCountryName(country.id)}
                  </span>
                </div>
                <span className="text-xs font-medium text-primary opacity-0 transition-opacity group-hover:opacity-100">
                  View details
                </span>
              </div>

              <div className="mt-4 grid gap-2 sm:grid-cols-4">
                <MiniMetric
                  label="GDP"
                  value={formatCompactCurrency(economy.gdp, economy.currencyCode)}
                  detail={`${formatCompactNumber(economy.population)} people`}
                />
                <MiniMetric
                  label="Debt / GDP"
                  value={formatPercent(getDebtToGdp(country.id), 0)}
                  detail={economy.creditRating}
                />
                <MiniMetric
                  label="Growth / CPI"
                  value={`${formatPointPercent(economy.gdpGrowth)} / ${formatPointPercent(
                    economy.inflationRate
                  )}`}
                  detail={`${economy.fiscalYear} seed`}
                />
                <MiniMetric
                  label="Resources"
                  value={topResource ? COMMODITY_LABELS[topResource.resource] : "None seeded"}
                  detail={
                    topResource
                      ? `${resources.resourceTypeCount} types; ${resources.activeRegionCount} regions`
                      : "No capacity"
                  }
                />
              </div>

              <SectorSpecialtySummaryChips countryId={country.id} />

              {topRegion && (
                <p className="mt-3 text-xs leading-relaxed text-muted">
                  Largest region economy:{" "}
                  <span className="font-medium text-foreground">{topRegion.name}</span> at{" "}
                  {formatCompactCurrency(topRegion.gdp * 1_000_000, economy.currencyCode)}.
                </p>
              )}
            </a>
          );
        })}
      </div>
    </section>
  );
}

function IdeologyPlot({ parties }: { parties: readonly PartySeed[] }) {
  return (
    <div className="rounded-lg border border-card-border bg-card/45 p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <h4 className="text-sm font-semibold text-foreground">Ideology Map</h4>
          <p className="mt-1 text-xs text-muted">
            Economic left/right and social stance, -5 to +5.
          </p>
        </div>
        <Scale className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
      </div>

      <div className="relative h-[220px] overflow-hidden rounded-md border border-card-border bg-card-elevated/70">
        <div className="absolute left-1/2 top-0 h-full w-px bg-card-border" />
        <div className="absolute left-0 top-1/2 h-px w-full bg-card-border" />
        <div className="absolute left-3 top-3 text-[10px] font-medium uppercase tracking-[0.08em] text-muted">
          Progressive
        </div>
        <div className="absolute bottom-3 left-3 text-[10px] font-medium uppercase tracking-[0.08em] text-muted">
          Left
        </div>
        <div className="absolute bottom-3 right-3 text-[10px] font-medium uppercase tracking-[0.08em] text-muted">
          Right
        </div>
        <div className="absolute right-3 top-3 text-[10px] font-medium uppercase tracking-[0.08em] text-muted">
          Traditional
        </div>

        {parties.map((party) => (
          <span
            key={party.abbreviation}
            aria-label={`${party.name}: economic ${formatSigned(
              party.economicPosition
            )}, social ${formatSigned(party.socialPosition)}`}
            title={`${party.name} (${party.abbreviation}) - economic ${formatSigned(
              party.economicPosition
            )}, social ${formatSigned(party.socialPosition)}`}
            className="absolute h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border border-white/80 shadow-[0_0_0_3px_rgba(0,0,0,0.22)]"
            style={getPartyPositionStyle(party, parties)}
          />
        ))}
      </div>
    </div>
  );
}

function PartyCard({ party, maxTreasury }: { party: PartySeed; maxTreasury: number }) {
  const treasuryWidth = Math.max(8, (party.treasury / maxTreasury) * 100);

  return (
    <article className="rounded-lg border border-card-border bg-card/45 p-3">
      <div className="flex items-start gap-3">
        <span
          className="mt-1 h-3 w-3 shrink-0 rounded-sm border border-white/40"
          style={{ backgroundColor: party.color }}
          aria-hidden="true"
        />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h4 className="break-words text-sm font-semibold leading-snug text-foreground">
              {party.name}
            </h4>
            <span className="rounded bg-card-elevated px-2 py-0.5 font-mono text-[11px] font-semibold text-muted">
              {party.abbreviation}
            </span>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2 text-xs sm:grid-cols-3">
            <div>
              <div className="text-muted">Economic</div>
              <div className="font-medium text-foreground">
                {formatSigned(party.economicPosition)}
                <span className="ml-1 text-muted">
                  {ideologyLabel("economic", party.economicPosition)}
                </span>
              </div>
            </div>
            <div>
              <div className="text-muted">Social</div>
              <div className="font-medium text-foreground">
                {formatSigned(party.socialPosition)}
                <span className="ml-1 text-muted">
                  {ideologyLabel("social", party.socialPosition)}
                </span>
              </div>
            </div>
            <div className="col-span-2 sm:col-span-1">
              <div className="text-muted">Treasury</div>
              <div className="font-medium text-foreground">{formatMoney(party.treasury)}</div>
            </div>
          </div>
          <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-card-elevated">
            <div
              className="h-full rounded-full"
              style={{ width: `${treasuryWidth}%`, backgroundColor: party.color }}
            />
          </div>
        </div>
      </div>
    </article>
  );
}

function StartingEconomyPanel({ countryId }: { countryId: StartingCountryId }) {
  const economy = STARTING_ECONOMY_BY_COUNTRY[countryId];
  const regions = REGIONS_BY_COUNTRY[countryId];
  const topRegion = getTopRegion(countryId);
  const debtToGdp = getDebtToGdp(countryId);
  const headroom = getDebtHeadroom(countryId);

  return (
    <section
      id={`starting-state-${countryId.toLowerCase()}-metrics`}
      className="scroll-mt-24 rounded-lg border border-card-border bg-card/45 p-4"
    >
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.1em] text-muted">
            <Activity className="h-3.5 w-3.5" aria-hidden="true" />
            Starting Metrics
          </div>
          <h4 className="mt-1 text-lg font-semibold text-foreground">
            Economy and fiscal position
          </h4>
        </div>
        <span className="rounded-md border border-card-border bg-card-elevated px-2.5 py-1 text-xs font-medium text-muted">
          FY {economy.fiscalYear}
        </span>
      </div>

      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
        <MiniMetric
          label="Economy Size"
          value={formatCompactCurrency(economy.gdp, economy.currencyCode)}
          detail={`${formatCompactNumber(economy.population)} population`}
        />
        <MiniMetric
          label="Opening Debt"
          value={formatCompactCurrency(economy.debtPrincipal, economy.currencyCode)}
          detail={`${formatPercent(debtToGdp, 0)} of GDP`}
        />
        <MiniMetric
          label="Debt Headroom"
          value={formatCompactCurrency(headroom, economy.currencyCode)}
          detail={`Ceiling ${formatCompactCurrency(economy.debtCeiling, economy.currencyCode)}`}
        />
        <MiniMetric
          label="Credit / Interest"
          value={`${economy.creditRating} / ${formatPercent(economy.debtInterestRate)}`}
          detail="Seeded sovereign terms"
        />
      </div>

      <div className="mt-3 grid gap-2 sm:grid-cols-4">
        <MiniMetric label="GDP Growth" value={formatPointPercent(economy.gdpGrowth)} />
        <MiniMetric label="Inflation" value={formatPointPercent(economy.inflationRate)} />
        <MiniMetric label="Wage Growth" value={formatPointPercent(economy.wageGrowth)} />
        <MiniMetric label="Trade Growth" value={formatPointPercent(economy.tradeGrowth)} />
      </div>

      <div className="mt-4 rounded-md border border-card-border bg-card-elevated/45 p-3">
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.1em] text-muted">
          <MapPinned className="h-3.5 w-3.5" aria-hidden="true" />
          Regional Baseline
        </div>
        <p className="mt-2 text-sm leading-relaxed text-muted">
          {regions.length} {COUNTRY_CONFIGS[countryId].regionLabelPlural.toLowerCase()} seed local
          GDP and population.{" "}
          {topRegion && (
            <>
              <span className="font-medium text-foreground">{topRegion.name}</span> is the largest
              regional economy at{" "}
              {formatCompactCurrency(topRegion.gdp * 1_000_000, economy.currencyCode)}.
            </>
          )}
        </p>
      </div>
    </section>
  );
}

function ResourceCapacityPanel({ countryId }: { countryId: StartingCountryId }) {
  const summary = getResourceSummary(countryId);
  const maxCapacity = Math.max(...summary.topResources.map((entry) => entry.value), 1);

  return (
    <section
      id={`starting-state-${countryId.toLowerCase()}-resources`}
      className="scroll-mt-24 rounded-lg border border-card-border bg-card/45 p-4"
    >
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.1em] text-muted">
            <Pickaxe className="h-3.5 w-3.5" aria-hidden="true" />
            Starting Resource Capacity
          </div>
          <h4 className="mt-1 text-lg font-semibold text-foreground">Extraction ceiling</h4>
        </div>
        <span className="rounded-md border border-card-border bg-card-elevated px-2.5 py-1 text-xs font-medium text-muted">
          {summary.resourceTypeCount} resource types
        </span>
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        <MiniMetric
          label="Resource Regions"
          value={String(summary.activeRegionCount)}
          detail="Regions with at least one seeded extractable resource."
        />
        <MiniMetric
          label="Market Context"
          value={`${CORPORATION_TYPES.length} sectors`}
          detail="Resource output constrains extraction-sector supply."
        />
      </div>

      <div className="mt-4 space-y-3">
        {summary.topResources.map((entry) => {
          const width = Math.max(8, (entry.value / maxCapacity) * 100);
          return (
            <div key={entry.resource}>
              <div className="mb-1 flex items-center justify-between gap-3 text-xs">
                <span className="font-medium text-foreground">
                  {COMMODITY_LABELS[entry.resource]}
                </span>
                <span className="text-muted">
                  {formatResourceCapacity(entry.resource, entry.value)}
                </span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-card-elevated">
                <div className="h-full rounded-full bg-primary" style={{ width: `${width}%` }} />
              </div>
            </div>
          );
        })}
      </div>

      {summary.resources.length > summary.topResources.length && (
        <p className="mt-3 text-xs leading-relaxed text-muted">
          Also seeded:{" "}
          {summary.resources
            .slice(summary.topResources.length)
            .map((entry) => COMMODITY_LABELS[entry.resource])
            .join(", ")}
          .
        </p>
      )}
    </section>
  );
}

function CountrySection({ country }: { country: CountryStartingStateCopy }) {
  const config = COUNTRY_CONFIGS[country.id];
  const parties = PARTY_SEEDS_BY_COUNTRY[country.id];
  const economy = STARTING_ECONOMY_BY_COUNTRY[country.id];
  const maxTreasury = Math.max(...parties.map((party) => party.treasury));
  const totalTreasury = parties.reduce((sum, party) => sum + party.treasury, 0);
  const majorPartyCount = config.majorPartyIds.length;

  return (
    <section
      id={`starting-state-${country.id.toLowerCase()}`}
      className="scroll-mt-24 border-t border-card-border/80 py-7"
    >
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-md border border-card-border bg-card-elevated px-2.5 py-1 font-mono text-xs font-semibold text-primary">
              {country.shortName}
            </span>
            <span className="rounded-md border border-card-border bg-card/45 px-2.5 py-1 text-xs font-medium text-muted">
              {getGovernmentOpening(country.id)}
            </span>
            <span className="rounded-md border border-card-border bg-card/45 px-2.5 py-1 text-xs font-medium text-muted">
              {parties.length} default parties
            </span>
            <span className="rounded-md border border-card-border bg-card/45 px-2.5 py-1 text-xs font-medium text-muted">
              {formatCompactCurrency(economy.gdp, economy.currencyCode)} GDP
            </span>
            <span className="rounded-md border border-card-border bg-card/45 px-2.5 py-1 text-xs font-medium text-muted">
              {formatPercent(getDebtToGdp(country.id), 0)} debt/GDP
            </span>
          </div>
          <h3 className="mt-3 text-2xl font-semibold tracking-tight text-foreground">
            {config.name}
          </h3>
          <p className="mt-2 max-w-3xl text-sm leading-relaxed text-muted">{country.posture}</p>

          <nav
            aria-label={`${config.name} starting-state sections`}
            className="mt-4 flex flex-wrap gap-2"
          >
            <a
              href={`#starting-state-${country.id.toLowerCase()}-metrics`}
              className="rounded-md border border-card-border bg-card/45 px-2.5 py-1.5 text-xs font-medium text-muted transition-colors hover:border-primary/50 hover:text-primary"
            >
              Metrics
            </a>
            <a
              href={`#starting-state-${country.id.toLowerCase()}-resources`}
              className="rounded-md border border-card-border bg-card/45 px-2.5 py-1.5 text-xs font-medium text-muted transition-colors hover:border-primary/50 hover:text-primary"
            >
              Resources
            </a>
            <a
              href={`#starting-state-${country.id.toLowerCase()}-specialties`}
              className="rounded-md border border-card-border bg-card/45 px-2.5 py-1.5 text-xs font-medium text-muted transition-colors hover:border-primary/50 hover:text-primary"
            >
              Specialties
            </a>
            <a
              href={`#starting-state-${country.id.toLowerCase()}-parties`}
              className="rounded-md border border-card-border bg-card/45 px-2.5 py-1.5 text-xs font-medium text-muted transition-colors hover:border-primary/50 hover:text-primary"
            >
              Parties
            </a>
          </nav>

          <div className="mt-5 grid gap-3 md:grid-cols-3">
            <div className="border-l border-primary/40 pl-3">
              <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.1em] text-muted">
                <Building2 className="h-3.5 w-3.5" aria-hidden="true" />
                System
              </div>
              <p className="mt-1 text-sm leading-relaxed text-foreground">{country.system}</p>
            </div>
            <div className="border-l border-primary/40 pl-3">
              <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.1em] text-muted">
                <Vote className="h-3.5 w-3.5" aria-hidden="true" />
                Legislature
              </div>
              <p className="mt-1 text-sm leading-relaxed text-foreground">{country.legislature}</p>
            </div>
            <div className="border-l border-primary/40 pl-3">
              <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.1em] text-muted">
                <Wallet className="h-3.5 w-3.5" aria-hidden="true" />
                Party Entry
              </div>
              <p className="mt-1 text-sm leading-relaxed text-foreground">
                {formatPartyCreationRule(country.id)} to found a new party.
              </p>
            </div>
          </div>
        </div>

        <IdeologyPlot parties={parties} />
      </div>

      <div className="mt-5 grid gap-4 xl:grid-cols-[minmax(0,1.15fr)_minmax(320px,0.85fr)]">
        <StartingEconomyPanel countryId={country.id} />
        <ResourceCapacityPanel countryId={country.id} />
      </div>

      <div className="mt-5">
        <SectorSpecialtyPanel countryId={country.id} />
      </div>

      <div className="mt-5 grid gap-4 lg:grid-cols-[minmax(0,1fr)_280px]">
        <div>
          <details
            id={`starting-state-${country.id.toLowerCase()}-parties`}
            className="scroll-mt-24 rounded-lg border border-card-border bg-card/35 p-4"
          >
            <summary className="flex cursor-pointer flex-wrap items-center justify-between gap-2 text-sm font-semibold uppercase tracking-[0.1em] text-muted marker:text-primary">
              <span>Starting Parties</span>
              <span className="text-xs font-medium normal-case tracking-normal text-muted">
                {formatMoney(totalTreasury)} treasury; {majorPartyCount} major-party IDs
              </span>
            </summary>
            <div className="mt-4 grid gap-3 md:grid-cols-2">
              {parties.map((party) => (
                <PartyCard key={party.abbreviation} party={party} maxTreasury={maxTreasury} />
              ))}
            </div>
          </details>
        </div>

        <aside className="space-y-3">
          <div className="rounded-lg border border-card-border bg-card/45 p-4">
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.1em] text-muted">
              <Users className="h-3.5 w-3.5" aria-hidden="true" />
              Starting NPPs
            </div>
            <p className="mt-2 text-sm leading-relaxed text-foreground">{country.nppSummary}</p>
            {country.nppDetails && (
              <div className="mt-3 flex flex-wrap gap-2">
                {country.nppDetails.map((detail) => (
                  <span
                    key={`${detail.label}-${detail.value}`}
                    className="rounded-md border border-card-border bg-card-elevated px-2.5 py-1 text-xs text-muted"
                  >
                    <span className="font-semibold text-foreground">{detail.label}:</span>{" "}
                    {detail.value}
                  </span>
                ))}
              </div>
            )}
          </div>

          <div className="rounded-lg border border-card-border bg-card/45 p-4">
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.1em] text-muted">
              <LayoutList className="h-3.5 w-3.5" aria-hidden="true" />
              Opening Notes
            </div>
            <ul className="mt-3 space-y-2">
              {country.highlights.map((highlight) => (
                <li key={highlight} className="flex gap-2 text-sm leading-relaxed text-muted">
                  <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
                  <span>{highlight}</span>
                </li>
              ))}
            </ul>
          </div>
        </aside>
      </div>
    </section>
  );
}

type Scenario = "1991" | "2019";

function ScenarioToggle({
  scenario,
  onChange,
}: {
  scenario: Scenario;
  onChange: (next: Scenario) => void;
}) {
  const options: { value: Scenario; label: string }[] = [
    { value: "1991", label: "1991 Start" },
    { value: "2019", label: "2019 Start" },
  ];

  return (
    <div className="rounded-lg border border-card-border bg-card/45 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.12em] text-muted">
          <CalendarClock className="h-3.5 w-3.5" aria-hidden="true" />
          Start Date
        </div>
        <div
          role="tablist"
          aria-label="Game start scenario"
          className="inline-flex rounded-md border border-card-border bg-card-elevated/60 p-1"
        >
          {options.map((option) => {
            const active = option.value === scenario;
            return (
              <button
                key={option.value}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => onChange(option.value)}
                className={`rounded px-3 py-1.5 text-sm font-semibold transition-colors ${
                  active ? "bg-primary text-white shadow-sm" : "text-muted hover:text-foreground"
                }`}
              >
                {option.label}
              </button>
            );
          })}
        </div>
      </div>
      <p className="mt-3 text-sm leading-relaxed text-muted">
        {scenario === "2019"
          ? "Canonical opening. Default party rosters, treasuries, macro numbers, and regional seeds drive this start."
          : "Early-90s opening. Displays seeded historical seat composition for US, UK, JP, DE, CN, BR, and IE. Macro data and 1991-era party rosters are still being reworked."}
      </p>
    </div>
  );
}

function ChamberBar({ chamber }: { chamber: ScenarioChamber }) {
  const totalWidthBase = Math.max(chamber.totalSeats, 1);

  return (
    <div className="rounded-md border border-card-border bg-card-elevated/55 p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h5 className="text-sm font-semibold text-foreground">{chamber.label}</h5>
        <span className="text-xs text-muted">{chamber.totalSeats} seats</span>
      </div>

      <div className="mt-3 flex h-2.5 w-full overflow-hidden rounded-full bg-card">
        {chamber.parties.map((party) => {
          const width = (party.seats / totalWidthBase) * 100;
          if (width <= 0) return null;
          return (
            <span
              key={`${chamber.shortLabel}-${party.partySlug}`}
              title={`${party.partyName}: ${party.seats}`}
              style={{ width: `${width}%`, backgroundColor: party.color }}
              aria-hidden="true"
            />
          );
        })}
      </div>

      <ul className="mt-3 flex flex-wrap gap-x-3 gap-y-1.5 text-xs text-muted">
        {chamber.parties.map((party) => (
          <li
            key={`${chamber.shortLabel}-${party.partySlug}-legend`}
            className="flex items-center gap-1.5"
          >
            <span
              className="h-2.5 w-2.5 rounded-sm border border-white/40"
              style={{ backgroundColor: party.color }}
              aria-hidden="true"
            />
            <span className="font-medium text-foreground">{party.partyName}</span>
            <span>{party.seats}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function ScenarioCountrySection({ scenario }: { scenario: ScenarioCountry }) {
  const config = COUNTRY_CONFIGS[scenario.countryId];
  const countryId = scenario.countryId as StartingCountryId;

  return (
    <section
      id={`starting-state-1991-${scenario.countryId.toLowerCase()}`}
      className="scroll-mt-24 border-t border-card-border/80 py-7"
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded-md border border-card-border bg-card-elevated px-2.5 py-1 font-mono text-xs font-semibold text-primary">
          {scenario.countryId}
        </span>
        <span className="rounded-md border border-card-border bg-card/45 px-2.5 py-1 text-xs font-medium text-muted">
          {scenario.contextLabel}
        </span>
      </div>
      <h3 className="mt-3 text-2xl font-semibold tracking-tight text-foreground">{config.name}</h3>
      <p className="mt-2 max-w-3xl text-sm leading-relaxed text-muted">{scenario.posture}</p>

      <div className="mt-5 grid gap-3 md:grid-cols-2">
        {scenario.chambers.map((chamber) => (
          <ChamberBar key={`${scenario.countryId}-${chamber.shortLabel}`} chamber={chamber} />
        ))}
      </div>

      <div className="mt-5 grid gap-4 xl:grid-cols-[minmax(0,1.15fr)_minmax(320px,0.85fr)]">
        <StartingEconomyPanel countryId={countryId} />
        <ResourceCapacityPanel countryId={countryId} />
      </div>
      <div className="mt-5">
        <SectorSpecialtyPanel countryId={countryId} />
      </div>
    </section>
  );
}

function UnseededCountrySection({
  countryId,
}: {
  countryId: (typeof STARTING_STATE_1991_UNSEEDED_COUNTRIES)[number];
}) {
  const config = COUNTRY_CONFIGS[countryId];

  return (
    <section
      id={`starting-state-1991-${countryId.toLowerCase()}`}
      className="scroll-mt-24 border-t border-card-border/80 py-7"
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded-md border border-card-border bg-card-elevated px-2.5 py-1 font-mono text-xs font-semibold text-primary">
          {countryId}
        </span>
        <span className="rounded-md border border-card-border bg-card/45 px-2.5 py-1 text-xs font-medium text-muted">
          No 1991 seat data
        </span>
      </div>
      <h3 className="mt-3 text-2xl font-semibold tracking-tight text-foreground">{config.name}</h3>
      <p className="mt-2 max-w-3xl text-sm leading-relaxed text-muted">
        No 1991 seat composition is seeded for {config.name}. 1991 scenario data is not available
        for this country.
      </p>
    </section>
  );
}

function StartingStateDashboard1991() {
  return (
    <div className="space-y-8">
      <div className="border-l-4 border-primary/60 pl-5">
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-primary">
          1991 Starting Audit
        </p>
        <h2 className="mt-2 text-3xl font-semibold tracking-tight text-foreground">
          The early-90s opening board
        </h2>
        <p className="mt-3 max-w-3xl text-sm leading-relaxed text-muted">
          Seeded historical seat composition for seven countries. The underlying preset is wired
          into admin reset as &ldquo;1991 Start Date - Default Parties&rdquo;. Macro economics,
          treasuries, regional sector specialties, and resource capacity for 1991 are not yet
          reworked — they currently fall back to the 2019 baseline at seed time.
        </p>
      </div>

      <nav
        aria-label="1991 country shortcuts"
        className="scroll-mt-24 rounded-lg border border-card-border bg-card/35 p-3"
      >
        <div className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.12em] text-muted">
          <Gauge className="h-3.5 w-3.5" aria-hidden="true" />
          Jump Index
        </div>
        <div className="flex flex-wrap gap-2">
          {STARTING_STATE_1991_COUNTRIES.map((country) => {
            const totalSeats = country.chambers.reduce(
              (sum, chamber) => sum + chamber.totalSeats,
              0
            );
            return (
              <a
                key={country.countryId}
                href={`#starting-state-1991-${country.countryId.toLowerCase()}`}
                className="rounded-md border border-card-border bg-card/45 px-3 py-2 text-sm text-muted transition-colors hover:border-primary/50 hover:text-primary"
              >
                <span className="font-mono font-semibold text-foreground">{country.countryId}</span>
                <span className="ml-2">{country.chambers.length} chambers</span>
                <span className="ml-2 text-xs">{totalSeats} seats</span>
              </a>
            );
          })}
          {STARTING_STATE_1991_UNSEEDED_COUNTRIES.map((countryId) => (
            <a
              key={countryId}
              href={`#starting-state-1991-${countryId.toLowerCase()}`}
              className="rounded-md border border-card-border bg-card/45 px-3 py-2 text-sm text-muted transition-colors hover:border-primary/50 hover:text-primary"
            >
              <span className="font-mono font-semibold text-foreground">{countryId}</span>
              <span className="ml-2 text-xs opacity-60">2019 baseline</span>
            </a>
          ))}
        </div>
      </nav>

      <div className="space-y-2">
        {STARTING_STATE_1991_COUNTRIES.map((country) => (
          <ScenarioCountrySection key={country.countryId} scenario={country} />
        ))}
        {STARTING_STATE_1991_UNSEEDED_COUNTRIES.map((countryId) => (
          <UnseededCountrySection key={countryId} countryId={countryId} />
        ))}
      </div>
    </div>
  );
}

function StartingStateDashboard2019() {
  const countries = COUNTRY_ORDER.map((id) => COUNTRY_COPY[id]);
  const totalParties = COUNTRY_ORDER.reduce(
    (sum, id) => sum + PARTY_SEEDS_BY_COUNTRY[id].length,
    0
  );
  const totalTreasury = COUNTRY_ORDER.reduce(
    (sum, id) =>
      sum +
      PARTY_SEEDS_BY_COUNTRY[id].reduce((countrySum, party) => countrySum + party.treasury, 0),
    0
  );
  const onePartyDominantCount = COUNTRY_ORDER.filter(
    (id) => COUNTRY_CONFIGS[id].governmentType === "onePartyState"
  ).length;
  const presidentialCount = COUNTRY_ORDER.filter(
    (id) => COUNTRY_CONFIGS[id].governmentType === "presidential"
  ).length;
  const parliamentaryCount = countries.length - presidentialCount - onePartyDominantCount;

  return (
    <div className="space-y-8">
      <div className="border-l-4 border-primary/60 pl-5">
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-primary">
          Starting Audit
        </p>
        <h2 className="mt-2 text-3xl font-semibold tracking-tight text-foreground">
          The opening board at a glance
        </h2>
        <p className="mt-3 max-w-3xl text-sm leading-relaxed text-muted">
          Every new world begins with protected default parties, empty legislatures, generated
          non-player politicians, and unowned sector markets. This view turns the seed data into
          scan-friendly country cards without changing the underlying starting facts.
        </p>
      </div>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          icon={Building2}
          label="Seeded Countries"
          value={String(countries.length)}
          detail="Each country has its own party field, legislature, executive rule, and NPP model."
        />
        <MetricCard
          icon={Users}
          label="Default Parties"
          value={String(totalParties)}
          detail="Protected parties exist at world creation and cannot be deleted by players."
        />
        <MetricCard
          icon={Banknote}
          label="Opening Treasury"
          value={formatMoney(totalTreasury)}
          detail="Total money held by default parties before dues, taxes, events, or player funding."
        />
        <MetricCard
          icon={BarChart2}
          label="Sector Markets"
          value={String(CORPORATION_TYPES.length)}
          detail="Every region starts with an unowned market pool for each corporation sector."
        />
      </div>

      <StartingMetricsMatrix countries={countries} />

      <div className="grid gap-3 md:grid-cols-3">
        <div className="rounded-lg border border-card-border bg-card/45 p-4">
          <div className="text-xs font-semibold uppercase tracking-[0.12em] text-muted">
            Government at Turn 0
          </div>
          <p className="mt-2 text-sm leading-relaxed text-foreground">
            Parliamentary countries start pending government formation. Presidential countries open
            on fixed executive cycles.
          </p>
        </div>
        <div className="rounded-lg border border-card-border bg-card/45 p-4">
          <div className="text-xs font-semibold uppercase tracking-[0.12em] text-muted">
            NPP Seeding
          </div>
          <p className="mt-2 text-sm leading-relaxed text-foreground">
            Most NPPs are generated dynamically. Germany is the exception, opening with a large
            named NPP pool.
          </p>
        </div>
        <div className="rounded-lg border border-card-border bg-card/45 p-4">
          <div className="text-xs font-semibold uppercase tracking-[0.12em] text-muted">
            Political Systems
          </div>
          <p className="mt-2 text-sm leading-relaxed text-foreground">
            {parliamentaryCount} parliamentary systems, {presidentialCount} presidential systems,
            and {onePartyDominantCount} one-party-dominant opening are documented here.
          </p>
        </div>
      </div>

      <nav
        id="country-index"
        aria-label="Starting state country shortcuts"
        className="scroll-mt-24 rounded-lg border border-card-border bg-card/35 p-3"
      >
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.12em] text-muted">
            <Gauge className="h-3.5 w-3.5" aria-hidden="true" />
            Jump Index
          </div>
          <a
            href="#starting-metrics"
            className="rounded-md border border-card-border bg-card-elevated px-2.5 py-1 text-xs font-medium text-muted transition-colors hover:border-primary/50 hover:text-primary"
          >
            Compare metrics
          </a>
        </div>
        <div className="flex flex-wrap gap-2">
          {countries.map((country) => {
            const parties = PARTY_SEEDS_BY_COUNTRY[country.id];
            const economy = STARTING_ECONOMY_BY_COUNTRY[country.id];
            return (
              <a
                key={country.id}
                href={`#starting-state-${country.id.toLowerCase()}`}
                className="rounded-md border border-card-border bg-card/45 px-3 py-2 text-sm text-muted transition-colors hover:border-primary/50 hover:text-primary"
              >
                <span className="font-mono font-semibold text-foreground">{country.shortName}</span>
                <span className="ml-2">{parties.length} parties</span>
                <span className="ml-2 text-xs">
                  {formatCompactCurrency(economy.gdp, economy.currencyCode)}
                </span>
              </a>
            );
          })}
        </div>
      </nav>

      <div className="space-y-2">
        {countries.map((country) => (
          <CountrySection key={country.id} country={country} />
        ))}
      </div>
    </div>
  );
}

export function StartingStateDashboard() {
  const [scenario, setScenario] = useState<Scenario>("2019");

  return (
    <div className="not-prose my-6 space-y-6">
      <ScenarioToggle scenario={scenario} onChange={setScenario} />
      {scenario === "2019" ? <StartingStateDashboard2019 /> : <StartingStateDashboard1991 />}
    </div>
  );
}
