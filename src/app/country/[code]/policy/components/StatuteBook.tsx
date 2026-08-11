"use client";

import { useState } from "react";
import Link from "next/link";
import type { PolicyRecordResponse } from "@/lib/policy/types";
import type { NationalAxes } from "@/lib/policy/nationalAxes";
import { PositionBadges } from "@/components/PositionBadges";
import { InfoTooltip } from "@/components/InfoTooltip";
import { formatPartyCountryMoney } from "@/lib/utils/formatters";
import {
  positionBucketHex,
  getEconomicPositionName,
  getSocialPositionName,
} from "@/lib/utils/politics";
import {
  dominantAxis,
  formatEnactedStamp,
  getDomainLabel,
  romanNumeral,
  type RecordPayload,
} from "./policyView";

const EUROPEAN_COLOUR_COUNTRIES = new Set(["UK", "DE"]);

const METRIC_NAMES: Record<string, string> = {
  unemploymentRate: "Unemployment",
  medianIncome: "Median Income",
  gdpGrowth: "GDP Growth",
  povertyRate: "Poverty Rate",
  costOfLiving: "Cost of Living",
  smallBusinessFormation: "Small Businesses",
  highSchoolGradRate: "HS Grad Rate",
  testPerformance: "Test Performance",
  educationSpending: "Education Spending",
  literacyRate: "Literacy Rate",
  workforceSkill: "Workforce Skills",
  uninsuredRate: "Uninsured Rate",
  affordabilityIndex: "Healthcare Affordability",
  physicianRate: "Physician Rate",
  lifeExpectancy: "Life Expectancy",
  preventableMortality: "Preventable Mortality",
  publicHealthPreparedness: "Health Preparedness",
  roadCondition: "Road Condition",
  broadbandAccess: "Broadband Access",
  publicTransit: "Public Transit",
  waterQuality: "Water Quality",
  powerGridReliability: "Grid Reliability",
  infrastructureInvestmentGap: "Investment Gap",
  crimeRate: "Crime Rate",
  violentCrimeRate: "Violent Crime",
  policePerCapita: "Police per Capita",
  incarcerationRate: "Incarceration",
  recidivismRate: "Recidivism",
  publicSafetyConfidence: "Safety Confidence",
  airQuality: "Air Quality",
  renewableEnergy: "Renewable Energy",
  carbonEmissions: "Carbon Emissions",
  recyclingRate: "Recycling Rate",
  climateResilience: "Climate Resilience",
  protectedLand: "Protected Land",
  socialMobility: "Social Mobility",
  incomeInequality: "Income Inequality",
  homelessnessRate: "Homelessness",
  foodInsecurity: "Food Insecurity",
  civicParticipation: "Civic Participation",
  socialCohesion: "Social Cohesion",
  governmentTransparency: "Transparency",
  budgetBalance: "Budget Balance",
  corruptionIndex: "Corruption",
  voterTurnout: "Voter Turnout",
  publicTrust: "Public Trust",
  populationGrowth: "Pop. Growth",
  urbanizationRate: "Urbanization",
  medianAge: "Median Age",
  migrationRate: "Migration Rate",
  mediaPolarization: "Media Polarization",
  disinformationRisk: "Disinfo Risk",
  pressFreedom: "Press Freedom",
  socialMediaSentiment: "Social Sentiment",
  newsTrust: "News Trust",
};

function leanWording(axis: "economic" | "social", value: number): string {
  const name = axis === "economic" ? getEconomicPositionName(value) : getSocialPositionName(value);
  return `leans ${name.toLowerCase()} ${value > 0 ? "+" : ""}${value.toFixed(1)}`;
}

/**
 * The statute book (Bold composite): one Title card per domain, serif law
 * names, mono provenance sublines from the enacted-law join, axis + fiscal
 * chips (the fiscal chip collapses where cost data isn't seeded), and the
 * pre-existing metric pills / tariff / subsidy treatments carried over.
 */
export function StatuteBook({
  countryId,
  domains,
  record,
  homeStateMetricBase,
}: {
  countryId: string;
  domains: { domain: string; records: PolicyRecordResponse[]; axes: NationalAxes }[];
  /** undefined = provenance still loading; null = unavailable — rows fall back either way. */
  record: RecordPayload | null | undefined;
  /** Base URL for metric-pill deep links (viewer's home state), or null. */
  homeStateMetricBase: string | null;
}) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const toggle = (domain: string) =>
    setCollapsed((previous) => {
      const next = new Set(previous);
      if (next.has(domain)) next.delete(domain);
      else next.add(domain);
      return next;
    });

  return (
    <div className="min-w-0 space-y-3.5">
      {domains.map(({ domain, records, axes }, index) => {
        const lean = dominantAxis(axes.economic, axes.social);
        const european = lean?.axis === "economic" && EUROPEAN_COLOUR_COUNTRIES.has(countryId);
        const isCollapsed = collapsed.has(domain);
        return (
          <section
            key={domain}
            id={`title-${domain}`}
            className="scroll-mt-24 overflow-hidden rounded-xl border border-card-border bg-card"
          >
            <button
              type="button"
              onClick={() => toggle(domain)}
              aria-expanded={!isCollapsed}
              className="flex w-full items-baseline justify-between gap-3 bg-card-muted px-5 py-3 text-left transition-colors hover:bg-card-elevated/40"
            >
              <span className="font-serif text-heading-sm font-semibold">
                Title {romanNumeral(index)} — {getDomainLabel(domain)}
              </span>
              <span className="shrink-0 font-mono text-[11px]">
                <span className="text-muted">
                  {records.length} {records.length === 1 ? "statute" : "statutes"}
                </span>
                {lean ? (
                  <span
                    className="ml-2"
                    // Bucket ramp hex — the established chart-colour exception.
                    style={{ color: positionBucketHex(lean.value, lean.axis, european) }}
                  >
                    {leanWording(lean.axis, lean.value)}
                  </span>
                ) : (
                  <span className="ml-2 text-muted/50">no axis positions</span>
                )}
                <span className="ml-2 text-muted">{isCollapsed ? "▸" : "▾"}</span>
              </span>
            </button>
            {!isCollapsed &&
              records.map((row) => {
                const provenance = record?.provenance[row.legislationTypeId] ?? null;
                return (
                  <div
                    key={row.legislationTypeId}
                    className="grid grid-cols-1 gap-x-4 gap-y-2 border-t border-card-border/50 px-5 py-3.5 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-baseline"
                  >
                    <div className="min-w-0">
                      <div className="font-serif text-body-lg font-semibold text-foreground">
                        {row.name}
                        {row.policyOptionName && (
                          <span className="text-muted"> — {row.policyOptionName}</span>
                        )}
                      </div>
                      <div className="mt-1 font-mono text-[11px] text-muted">
                        {provenance
                          ? `enacted ${formatEnactedStamp(provenance.enactedYear, provenance.enactedAt)} · per ${provenance.title}`
                          : row.recordType === "tariff"
                            ? "active tariff"
                            : row.recordType === "subsidy"
                              ? "active subsidy"
                              : row.activeOrder
                                ? `by executive order · ${row.activeOrder.issuedByName}`
                                : "standing law"}
                        {row.detailText ? ` · ${row.detailText}` : ""}
                      </div>
                      {row.metricEffects.length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {row.metricEffects.map((effect) => {
                            const isPositive = effect.ratePerTurn > 0;
                            const perYear = effect.ratePerTurn * 48;
                            const pillClass = `inline-flex items-center gap-0.5 rounded border px-1.5 py-0.5 text-[10px] font-medium ${
                              isPositive
                                ? "border-success/20 bg-success/10 text-success"
                                : "border-error/20 bg-error/10 text-error"
                            }`;
                            const metricHref = homeStateMetricBase
                              ? `${homeStateMetricBase}/metrics/${effect.category}/${effect.metricId}`
                              : undefined;
                            const label = METRIC_NAMES[effect.metricId] ?? effect.metricId;
                            return (
                              <InfoTooltip
                                key={`${effect.category}-${effect.metricId}`}
                                trigger={
                                  metricHref ? (
                                    <Link
                                      href={metricHref}
                                      className={`${pillClass} hover:opacity-80`}
                                    >
                                      <span>{isPositive ? "↑" : "↓"}</span>
                                      <span>{label}</span>
                                    </Link>
                                  ) : (
                                    <span className={pillClass}>
                                      <span>{isPositive ? "↑" : "↓"}</span>
                                      <span>{label}</span>
                                    </span>
                                  )
                                }
                                width={200}
                              >
                                <p className="mb-1.5 font-semibold text-foreground">{label}</p>
                                <div className="space-y-1 text-muted">
                                  <div className="flex justify-between gap-4">
                                    <span>Per turn:</span>
                                    <span
                                      className={`font-medium tabular-nums ${isPositive ? "text-success" : "text-error"}`}
                                    >
                                      {isPositive ? "+" : ""}
                                      {effect.ratePerTurn.toFixed(3)}
                                    </span>
                                  </div>
                                  <div className="flex justify-between gap-4">
                                    <span>Per year:</span>
                                    <span
                                      className={`font-medium tabular-nums ${isPositive ? "text-success" : "text-error"}`}
                                    >
                                      {isPositive ? "+" : ""}
                                      {perYear.toFixed(2)}
                                    </span>
                                  </div>
                                  {metricHref && (
                                    <p className="pt-1 text-[9px] text-muted/60">
                                      Click to view in your home state
                                    </p>
                                  )}
                                </div>
                              </InfoTooltip>
                            );
                          })}
                        </div>
                      )}
                      {(row.weightedEffects?.length ?? 0) > 0 && (
                        <div className="mt-1.5 flex flex-wrap gap-1.5">
                          {row.weightedEffects!.map((effect) => {
                            const label = METRIC_NAMES[effect.metricId] ?? effect.metricId;
                            const pillClass = `inline-flex items-center gap-0.5 rounded border px-1.5 py-0.5 text-[10px] font-medium opacity-70 ${
                              effect.isPositive
                                ? "border-success/20 bg-success/10 text-success"
                                : "border-error/20 bg-error/10 text-error"
                            }`;
                            const metricHref = homeStateMetricBase
                              ? `${homeStateMetricBase}/metrics/${effect.metricCategoryId}/${effect.metricId}`
                              : undefined;
                            return metricHref ? (
                              <Link
                                key={`${effect.metricCategoryId}-${effect.metricId}`}
                                href={metricHref}
                                className={`${pillClass} hover:opacity-80`}
                                title="Indirect policy-decay effect"
                              >
                                <span>{effect.isPositive ? "↑" : "↓"}</span>
                                <span>~{label}</span>
                              </Link>
                            ) : (
                              <span
                                key={`${effect.metricCategoryId}-${effect.metricId}`}
                                className={pillClass}
                                title="Indirect policy-decay effect"
                              >
                                <span>{effect.isPositive ? "↑" : "↓"}</span>
                                <span>~{label}</span>
                              </span>
                            );
                          })}
                        </div>
                      )}
                    </div>
                    <div className="flex shrink-0 flex-wrap items-center gap-1.5 sm:justify-end">
                      {row.recordType === "tariff" ? (
                        <span className="rounded-full border border-error/30 bg-error/10 px-2.5 py-0.5 text-xs font-semibold text-error">
                          {row.tariffRate}% active
                        </span>
                      ) : row.recordType === "subsidy" ? (
                        <span className="rounded-full border border-success/30 bg-success/10 px-2.5 py-0.5 text-xs font-semibold text-success">
                          +7.5% margin active
                        </span>
                      ) : (
                        <>
                          <PositionBadges
                            economic={row.hasEconomic ? row.economic : undefined}
                            social={row.hasSocial ? row.social : undefined}
                          />
                          {provenance?.annualCost != null && provenance.annualCost > 0 && (
                            <span className="rounded border border-error/20 bg-error/10 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-error">
                              −{formatPartyCountryMoney(provenance.annualCost, countryId)}/yr
                            </span>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                );
              })}
          </section>
        );
      })}
    </div>
  );
}
