"use client";

/**
 * The region's Laws & Policy tab.
 *
 * A thin fetch-and-render shell around `PolicyBook`, the same component the
 * national policy page uses. It previously carried its own renderer — its own
 * eight-entry domain-label table against the national file's seventeen, no
 * titles, no provenance, no axis summary — which is how GA's `tax` and
 * `economy` sections ended up headed by their raw internal keys.
 */

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import type { State } from "@/lib/db/types";
import type { StateTaxRates } from "@/lib/db/types/budget";
import type { CountryId } from "@/lib/constants/countries";
import { policyApiUrl, regionApiSubUrl, regionUrl } from "@/lib/urls";
import { PolicyBook } from "@/app/country/[code]/policy/components/PolicyBook";
import type { PolicyView } from "@/app/country/[code]/policy/components/PolicyMasthead";
import type { RecordPayload } from "@/app/country/[code]/policy/components/policyView";
// The canonical shape the /policy endpoint actually returns. StatePageTabsTypes
// carries a narrower local copy that predates the statute book and lacks
// metricEffects, which is the field the effect pills render from.
import type { PolicyRecordResponse } from "@/lib/policy/types";

export function LawsTab({ state }: { state: State }) {
  const searchParams = useSearchParams();
  const [records, setRecords] = useState<PolicyRecordResponse[]>([]);
  const [taxRates, setTaxRates] = useState<StateTaxRates | null>(null);
  // undefined = loading; null = unavailable.
  const [recordPayload, setRecordPayload] = useState<RecordPayload | null | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  // Local rather than URL-persisted: the region page already owns `?tab`/`?sub`,
  // and a third param competing for the same URL would fight the tab nav.
  const [view, setView] = useState<PolicyView>(
    searchParams?.get("view") === "record" ? "record" : "code"
  );

  const { _id: stateId, countryId } = state;

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      fetch(`${policyApiUrl(countryId)}?scope=state&stateId=${encodeURIComponent(stateId)}`).then(
        (res) => (res.ok ? res.json() : [])
      ),
      fetch(regionApiSubUrl(countryId, stateId, "budget")).then((res) =>
        res.ok ? res.json() : null
      ),
    ])
      .then(([policyData, budgetData]) => {
        if (cancelled) return;
        setRecords(Array.isArray(policyData) ? policyData : []);
        if (budgetData?.taxRates) setTaxRates(budgetData.taxRates);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    // The region's own enactment timeline. Separate from the two above so a
    // Record failure cannot blank the statute book.
    fetch(regionApiSubUrl(countryId, stateId, "policy/record"))
      .then((res) => (res.ok ? res.json() : null))
      .catch(() => null)
      .then((payload) => {
        if (!cancelled) setRecordPayload(payload ?? null);
      });

    return () => {
      cancelled = true;
    };
  }, [stateId, countryId]);

  return (
    <PolicyBook
      countryId={countryId as CountryId}
      scope="state"
      region={{ id: stateId, name: state.name }}
      records={records}
      recordPayload={recordPayload}
      // The drift-based social axis is a country-level series; a region has no
      // equivalent, so the masthead falls back to its enacted-law average.
      socialAxisPosition={null}
      loading={loading}
      view={view}
      onViewChange={setView}
      taxRates={taxRates}
      homeStateMetricBase={regionUrl(countryId, stateId)}
    />
  );
}

export default LawsTab;
