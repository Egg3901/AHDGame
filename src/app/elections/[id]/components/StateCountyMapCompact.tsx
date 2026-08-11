"use client";

import { useState, useEffect } from "react";
import { SubdivisionMap, type SubdivisionDatum } from "@/components/SubdivisionMap";
import Link from "next/link";
import { electionRegionUrl } from "@/lib/urls";

interface StateCountyMapCompactProps {
  electionId: string;
  state: string;
  electionType: string;
  countryId: string;
}

interface CountyMapData {
  viewBox: string;
  subdivisions: SubdivisionDatum[];
  candidateNames: Record<string, string>;
  candidateParties: Record<string, string>;
  partyColors?: Record<string, string>;
}

export function StateCountyMapCompact({
  electionId,
  state,
  electionType: _electionType,
  countryId,
}: StateCountyMapCompactProps) {
  const [data, setData] = useState<CountyMapData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchCountyData() {
      try {
        const res = await fetch(`/api/elections/${electionId}/state/${state}/subdivision-results`);
        if (!res.ok) {
          if (res.status === 404) {
            setError("County map data not yet available");
          } else {
            setError("Failed to load county map");
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

    fetchCountyData();
  }, [electionId, state]);

  if (loading) {
    return (
      <div className="rounded-lg border border-card-border bg-card p-6 mb-6">
        <div className="flex items-center justify-center text-sm text-muted">
          Loading county map...
        </div>
      </div>
    );
  }

  if (error || !data) {
    return null; // Silently hide if no data
  }

  return (
    <div className="rounded-lg border border-card-border bg-card p-4 mb-6">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-foreground">County Results — {state}</h3>
        <Link
          href={electionRegionUrl(electionId, countryId, state)}
          className="text-xs text-primary hover:underline"
        >
          View full map →
        </Link>
      </div>
      <div className="w-full">
        <SubdivisionMap
          viewBox={data.viewBox}
          subdivisions={data.subdivisions}
          candidateNames={data.candidateNames}
          candidateParties={data.candidateParties}
          partyColors={data.partyColors}
          showBackgroundMap={true}
        />
      </div>
    </div>
  );
}
