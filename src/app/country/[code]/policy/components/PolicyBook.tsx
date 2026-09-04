"use client";

/**
 * The statute book, at NATIONAL or STATE scope.
 *
 * Both scopes read the same endpoint and receive the same
 * `PolicyRecordResponse[]`; only the renderer used to differ, and the state one
 * had drifted — its own eight-entry domain-label table against this file's
 * seventeen, no titles, no provenance, no axis summary. One component removes
 * the class of bug rather than the two instances of it.
 */

import { useMemo, useState } from "react";
import type { CountryId } from "@/lib/constants/countries";
import type { PolicyRecordResponse } from "@/lib/policy/types";
import type { StateTaxRates } from "@/lib/db/types/budget";
import { computeDomainAxes, computeNationalAxes } from "@/lib/policy/nationalAxes";
import { Skeleton } from "@/components/ui";
import { PolicyMasthead, type PolicyView } from "./PolicyMasthead";
import { TitlesRail } from "./TitlesRail";
import { StatuteBook } from "./StatuteBook";
import { RecordView } from "./RecordView";
import { TaxRateFallbackPanel } from "./TaxRateFallbackPanel";
import { groupByDomain, type RecordPayload } from "./policyView";

export interface PolicyBookProps {
  countryId: CountryId;
  scope: "national" | "state";
  /** Region id and display name. Required when scope is "state". */
  region?: { id: string; name: string };
  records: PolicyRecordResponse[];
  /** undefined = still loading; null = unavailable. */
  recordPayload: RecordPayload | null | undefined;
  socialAxisPosition: number | null;
  loading: boolean;
  view: PolicyView;
  onViewChange: (view: PolicyView) => void;
  /**
   * Fallback state tax rates. Rendered ONLY when the records carry no
   * `tax`-domain row, so a country whose state taxes are catalog laws does not
   * list every rate twice.
   */
  taxRates?: StateTaxRates | null;
  /** Base URL for metric-pill deep links, or null. */
  homeStateMetricBase: string | null;
}

export function PolicyBook({
  countryId,
  scope,
  region,
  records,
  recordPayload,
  socialAxisPosition,
  loading,
  view,
  onViewChange,
  taxRates,
  homeStateMetricBase,
}: PolicyBookProps) {
  const [activeDomain, setActiveDomain] = useState<string | null>(null);

  const byDomain = useMemo(() => groupByDomain(records), [records]);
  const domainAxes = useMemo(() => computeDomainAxes(records), [records]);
  const axes = useMemo(() => computeNationalAxes(records), [records]);

  const domains = useMemo(
    () =>
      [...byDomain.entries()].map(([domain, domainRecords]) => ({
        domain,
        records: domainRecords,
        count: domainRecords.length,
        axes: domainAxes.get(domain) ?? {
          economic: null,
          social: null,
          lawCount: 0,
          economicCount: 0,
          socialCount: 0,
        },
      })),
    [byDomain, domainAxes]
  );

  const statuteCount = records.filter((record) => record.recordType !== "tariff").length;
  const lastEnacted = useMemo(() => {
    const stamps = Object.values(recordPayload?.provenance ?? {});
    if (stamps.length === 0) return null;
    const latest = stamps.reduce((a, b) =>
      new Date(a.enactedAt).getTime() >= new Date(b.enactedAt).getTime() ? a : b
    );
    return `${latest.enactedYear}`;
  }, [recordPayload]);

  const hasTaxRecords = records.some((r) => (r.policyDomain || "governance") === "tax");
  const showTaxFallback = scope === "state" && Boolean(taxRates) && !hasTaxRecords;

  const scrollToDomain = (domain: string) => {
    setActiveDomain(domain);
    document.getElementById(`title-${domain}`)?.scrollIntoView({ behavior: "smooth" });
  };

  const emptyText =
    scope === "state"
      ? `No laws of its own on the books in ${region?.name ?? "this region"} yet.`
      : "No national laws on the books yet.";

  return (
    <>
      <div className="mb-6">
        <PolicyMasthead
          countryId={countryId}
          statuteCount={statuteCount}
          titleCount={domains.length}
          lastEnactedStamp={lastEnacted}
          axes={loading ? null : axes}
          socialAxisPosition={loading ? null : socialAxisPosition}
          view={view}
          onViewChange={onViewChange}
          scopeLabel={scope === "state" ? region?.name : undefined}
        />
      </div>

      {loading ? (
        <div className="grid gap-5 lg:grid-cols-[200px_minmax(0,1fr)]" aria-hidden>
          <Skeleton className="h-48 rounded-xl" />
          <div className="space-y-3.5">
            <Skeleton className="h-40 rounded-xl" />
            <Skeleton className="h-14 rounded-xl" />
            <Skeleton className="h-14 rounded-xl" />
          </div>
        </div>
      ) : view === "record" ? (
        <RecordView
          countryId={countryId}
          record={recordPayload}
          scopeName={scope === "state" ? region?.name : undefined}
        />
      ) : records.length === 0 && !showTaxFallback ? (
        <div className="rounded-xl border border-card-border bg-card p-12 text-center text-sm italic text-muted">
          {emptyText}
        </div>
      ) : (
        <div
          className={
            domains.length > 0 ? "grid gap-5 lg:grid-cols-[200px_minmax(0,1fr)]" : "grid gap-5"
          }
        >
          {/* A region with only the fallback tax panel has no titles to list,
              and an empty rail beside it reads as a broken column. */}
          {domains.length > 0 && (
            <TitlesRail
              countryId={countryId}
              domains={domains}
              activeDomain={activeDomain}
              onSelect={scrollToDomain}
            />
          )}
          <div className="min-w-0 space-y-3.5">
            {showTaxFallback && taxRates && <TaxRateFallbackPanel taxRates={taxRates} />}
            <StatuteBook
              countryId={countryId}
              domains={domains}
              record={recordPayload}
              homeStateMetricBase={homeStateMetricBase}
            />
          </div>
        </div>
      )}
    </>
  );
}

export default PolicyBook;
