"use client";

import { useState, useEffect } from "react";
import { SubdivisionMap, type SubdivisionDatum } from "@/components/SubdivisionMap";
import Link from "next/link";
import { electionRegionUrl } from "@/lib/urls";

interface StateSubdivisionMapCompactProps {
  electionId: string;
  state: string;
  countryId: string;
  /** Region display name; falls back to the region code. */
  stateName?: string;
}

interface SubdivisionMapData {
  viewBox: string;
  unitLabel?: string;
  subdivisions: SubdivisionDatum[];
  candidateNames: Record<string, string>;
  candidateParties: Record<string, string>;
  partyColors?: Record<string, string>;
}

/** Compact sub-region results map (e.g. UK constituencies) for the election
 *  detail page, linking through to the full region results page. */
export function StateSubdivisionMapCompact({
  electionId,
  state,
  countryId,
  stateName,
}: StateSubdivisionMapCompactProps) {
  const [data, setData] = useState<SubdivisionMapData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchSubdivisionData() {
      try {
        const res = await fetch(`/api/elections/${electionId}/state/${state}/subdivision-results`);
        if (!res.ok) {
          if (res.status === 404) {
            setError("Subdivision map data not yet available");
          } else {
            setError("Failed to load subdivision map");
          }
          return;
        }
        const json = await res.json();
        setData(json);
      } catch {
        setError("Network error");
      } finally {
        setLoading(false);
      }
    }

    fetchSubdivisionData();
  }, [electionId, state]);

  if (loading) {
    return (
      <div className="rounded-lg border border-card-border bg-card p-6 mb-6">
        <div className="flex items-center justify-center text-sm text-muted">Loading map...</div>
      </div>
    );
  }

  if (error || !data) {
    return null; // Silently hide if no data
  }

  return (
    <div className="rounded-lg border border-card-border bg-card p-4 mb-6">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-foreground">
          {data.unitLabel ?? "Subdivision"} Results — {stateName ?? state}
        </h3>
        <Link
          href={electionRegionUrl(electionId, countryId, state)}
          className="text-xs text-primary hover:underline"
        >
          View full map →
        </Link>
      </div>
      <div className="w-full max-w-sm mx-auto">
        <SubdivisionMap
          viewBox={data.viewBox}
          subdivisions={data.subdivisions}
          candidateNames={data.candidateNames}
          candidateParties={data.candidateParties}
          partyColors={data.partyColors}
        />
      </div>
    </div>
  );
}
