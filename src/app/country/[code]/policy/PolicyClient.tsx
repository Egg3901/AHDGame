"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useParams, usePathname, useRouter, useSearchParams } from "next/navigation";
import type { CountryId } from "@/lib/constants/countries";
import { COUNTRY_CONFIGS } from "@/lib/constants/countries";
import type { PolicyRecordResponse } from "@/lib/policy/types";
import { computeDomainAxes, computeNationalAxes } from "@/lib/policy/nationalAxes";
import { useUserData } from "@/hooks/useUserData";
import { policyApiUrl, regionUrl, socialAxisApiUrl } from "@/lib/urls";
import { fetchJson } from "@/lib/observability/fetchJson";
import { PolicyMasthead, type PolicyView } from "./components/PolicyMasthead";
import { TitlesRail } from "./components/TitlesRail";
import { StatuteBook } from "./components/StatuteBook";
import { RecordView } from "./components/RecordView";
import { groupByDomain, type RecordPayload } from "./components/policyView";
import { Skeleton } from "@/components/ui";

interface PolicyClientProps {
  /** Server-seeded national policy records so the page renders without a client round trip. */
  initialRecords?: PolicyRecordResponse[];
  /** Server-seeded record payload (null when the server load failed). */
  initialRecordPayload?: RecordPayload | null;
}

export default function PolicyClient({ initialRecords, initialRecordPayload }: PolicyClientProps) {
  const { code } = useParams<{ code: string }>();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const country = code?.toLowerCase() || "us";
  const countryId = country.toUpperCase() as CountryId;
  const [records, setRecords] = useState<PolicyRecordResponse[]>(initialRecords ?? []);
  const [socialAxis, setSocialAxis] = useState<number | null>(null);
  // undefined = loading; null = fetch failed; payload = loaded.
  const [recordPayload, setRecordPayload] = useState<RecordPayload | null | undefined>(
    initialRecordPayload
  );
  // Seeded from the server → no initial spinner for the records/record fetches.
  const [loading, setLoading] = useState(initialRecords === undefined);
  // Skip the first records/record client fetch when the server already provided
  // it; the country param is fixed for this mount (a different country is a
  // different route segment → a fresh server render). The social-axis fetch
  // below always runs client-side (it is auth-gated and per-session).
  const skipInitialRecordsFetch = useRef(initialRecords !== undefined);
  const [activeDomain, setActiveDomain] = useState<string | null>(null);
  const { homeState } = useUserData();

  // Code is the default; the Record state lives in the URL (shareable).
  const view: PolicyView = searchParams.get("view") === "record" ? "record" : "code";
  const setView = (next: PolicyView) => {
    const params = new URLSearchParams(searchParams.toString());
    if (next === "record") params.set("view", "record");
    else params.delete("view");
    const queryString = params.toString();
    router.replace(queryString ? `${pathname}?${queryString}` : pathname, { scroll: false });
  };

  useEffect(() => {
    if (skipInitialRecordsFetch.current) {
      skipInitialRecordsFetch.current = false;
      return;
    }
    let cancelled = false;
    fetchJson<PolicyRecordResponse[]>(`${policyApiUrl(country)}?scope=national`, {
      feature: "policy-records",
    })
      .catch(() => [])
      .then((policyData) => {
        if (!cancelled) setRecords(Array.isArray(policyData) ? policyData : []);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    fetchJson<RecordPayload | null>(`${policyApiUrl(country)}/record`, {
      feature: "policy-record",
    })
      .catch(() => null)
      .then((payload) => {
        if (!cancelled) setRecordPayload(payload);
      });
    return () => {
      cancelled = true;
    };
  }, [country]);

  useEffect(() => {
    fetchJson<{ socialAxisPosition?: number } | null>(socialAxisApiUrl(country), {
      feature: "policy-social-axis",
    })
      .then((data) => {
        if (data && typeof data.socialAxisPosition === "number") {
          setSocialAxis(data.socialAxisPosition);
        }
      })
      .catch(() => setSocialAxis(null));
  }, [country]);

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

  const scrollToDomain = (domain: string) => {
    setActiveDomain(domain);
    document.getElementById(`title-${domain}`)?.scrollIntoView({ behavior: "smooth" });
  };

  if (!COUNTRY_CONFIGS[countryId]) return null;

  return (
    <div className="min-h-screen bg-background pb-16">
      <main className="mx-auto max-w-6xl overflow-x-hidden px-4 py-8 sm:px-6">
        <div className="mb-6">
          <PolicyMasthead
            countryId={countryId}
            statuteCount={statuteCount}
            titleCount={domains.length}
            lastEnactedStamp={lastEnacted}
            axes={loading ? null : axes}
            socialAxisPosition={loading ? null : socialAxis}
            view={view}
            onViewChange={setView}
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
        ) : records.length === 0 ? (
          <div className="rounded-xl border border-card-border bg-card p-12 text-center text-sm italic text-muted">
            No national laws on the books yet.
          </div>
        ) : view === "record" ? (
          <RecordView countryId={countryId} record={recordPayload} />
        ) : (
          <div className="grid gap-5 lg:grid-cols-[200px_minmax(0,1fr)]">
            <TitlesRail
              countryId={countryId}
              domains={domains}
              activeDomain={activeDomain}
              onSelect={scrollToDomain}
            />
            <StatuteBook
              countryId={countryId}
              domains={domains}
              record={recordPayload}
              homeStateMetricBase={homeState ? regionUrl(country, homeState.id) : null}
            />
          </div>
        )}
      </main>
    </div>
  );
}
