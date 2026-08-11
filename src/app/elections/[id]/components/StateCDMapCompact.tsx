"use client";

import { useState, useEffect } from "react";
import { SubdivisionMap, type SubdivisionDatum } from "@/components/SubdivisionMap";
import Link from "next/link";
import { electionRegionUrl } from "@/lib/urls";

interface StateCDMapCompactProps {
  electionId: string;
  state: string;
  countryId: string;
}

interface CDMapData {
  viewBox: string;
  subdivisions: SubdivisionDatum[];
  candidateNames: Record<string, string>;
  candidateParties: Record<string, string>;
  partyColors?: Record<string, string>;
}

export function StateCDMapCompact({ electionId, state, countryId }: StateCDMapCompactProps) {
  const [data, setData] = useState<CDMapData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchCDData() {
      try {
        const res = await fetch(`/api/elections/${electionId}/state/${state}/subdivision-results`);
        if (!res.ok) {
          if (res.status === 404) {
            setError("CD map data not yet available");
          } else {
            setError("Failed to load CD map");
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

    fetchCDData();
  }, [electionId, state]);

  if (loading) {
    return (
      <div className="rounded-lg border border-card-border bg-card p-6 mb-6">
        <div className="flex items-center justify-center text-sm text-muted">
          Loading district map...
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
        <h3 className="text-sm font-semibold text-foreground">District Results — {state}</h3>
        <Link
          href={electionRegionUrl(electionId, countryId, state)}
          className="text-xs text-primary hover:underline"
        >
          View full map →
        </Link>
      </div>
      <div className="w-64 mx-auto">
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
