"use client";

import { useEffect, useRef, useState } from "react";
import { useParams, usePathname, useRouter, useSearchParams } from "next/navigation";
import type { CountryId } from "@/lib/constants/countries";
import { COUNTRY_CONFIGS } from "@/lib/constants/countries";
import type { PolicyRecordResponse } from "@/lib/policy/types";
import { useUserData } from "@/hooks/useUserData";
import { policyApiUrl, regionUrl, socialAxisApiUrl } from "@/lib/urls";
import { fetchJson } from "@/lib/observability/fetchJson";
import type { PolicyView } from "./components/PolicyMasthead";
import { PolicyBook } from "./components/PolicyBook";
import type { RecordPayload } from "./components/policyView";

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

  if (!COUNTRY_CONFIGS[countryId]) return null;

  return (
    <div className="min-h-screen bg-background pb-16">
      <main className="mx-auto max-w-6xl overflow-x-hidden px-4 py-8 sm:px-6">
        <PolicyBook
          countryId={countryId}
          scope="national"
          records={records}
          recordPayload={recordPayload}
          socialAxisPosition={socialAxis}
          loading={loading}
          view={view}
          onViewChange={setView}
          homeStateMetricBase={homeState ? regionUrl(country, homeState.id) : null}
        />
      </main>
    </div>
  );
}
