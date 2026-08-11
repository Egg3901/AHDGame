"use client";

import { useCallback, useEffect, useState } from "react";
import type { CountryId } from "@/lib/constants/countries";
import { ReferendumConsentCard, type ConsentReferendum } from "./ReferendumConsentCard";

interface ConsentResponse {
  referendums: ConsentReferendum[];
  isPM: boolean;
  isAdmin: boolean;
  currentTurn: number;
}

/**
 * Self-fetching wrapper for the national referendum consent surface. Mounted on
 * the UK executive (PM's office) hub — granting/declining a referendum is the
 * PM's call. Renders nothing unless a UK referendum is awaiting the PM's
 * decision, in its campaign, or in the dual-bill conversion window.
 */
export function ReferendumConsentSection({ countryId }: { countryId: CountryId }) {
  const [data, setData] = useState<ConsentResponse | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/country/${countryId.toLowerCase()}/referendum`);
      if (!res.ok) return;
      setData((await res.json()) as ConsentResponse);
    } catch {
      // Non-critical surface — stay silent on transient fetch failures.
    }
  }, [countryId]);

  useEffect(() => {
    void load(); // eslint-disable-line react-hooks/set-state-in-effect -- initial data fetch
  }, [load]);

  if (countryId !== "UK" || !data || data.referendums.length === 0) return null;

  return (
    <div className="mb-6">
      <ReferendumConsentCard
        countryId={countryId}
        currentTurn={data.currentTurn}
        referendums={data.referendums}
        isPM={data.isPM}
        isAdmin={data.isAdmin}
        onChanged={load}
      />
    </div>
  );
}
