"use client";

import React from "react";
import Link from "next/link";
import BackButton from "@/components/BackButton";
import { useWorldFlags } from "@/hooks/useWorldFlags";
import { US_STATE_NAMES } from "./ElectionDetailHelpers";
import type { ElectionDetail } from "./ElectionDetailTypes";

/**
 * Builds an election URL from an ID that may be:
 * - A seatId with cycle: "US-senate-PA-1?cycle=2"
 * - A legacy ObjectId: "69b5b04bdf051bb43fc957b7"
 */
function buildElectionUrl(id: string): string {
  // If it contains "?", it's a seatId with query params
  if (id.includes("?")) {
    const [seatId, query] = id.split("?");
    return `/elections/${seatId}?${query}`;
  }
  return `/elections/${id}`;
}

interface ElectionNavigationProps {
  election: ElectionDetail;
}

export function ElectionNavigation({ election }: ElectionNavigationProps) {
  const { liveElectionResultsEnabled } = useWorldFlags();
  const fallbackElectionsHref = `/country/${(election.countryId ?? "US").toLowerCase()}/elections`;
  // Breadcrumb shows the scope only. The full title lives in the <h1> below —
  // rendering it twice, ~40px apart, was pure noise.
  const scopeText =
    election.state === "US" ? "National" : (US_STATE_NAMES[election.state] ?? election.state);
  const showLiveResults = liveElectionResultsEnabled && election.status !== "upcoming";

  return (
    <>
      <div className="mb-6 flex items-center gap-2 text-sm">
        <BackButton fallbackLabel="Back to Elections" fallbackHref={fallbackElectionsHref} />
        <span className="text-card-border">/</span>
        <span className="min-w-0 truncate font-medium">{scopeText}</span>
        {showLiveResults && (
          <Link
            href={`/elections/${election.id}/results`}
            className="ml-auto inline-flex shrink-0 items-center gap-1.5 rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-xs font-medium text-primary transition-colors hover:bg-primary/20"
          >
            {election.status === "active" && (
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-primary" />
            )}
            Live Results
          </Link>
        )}
      </div>

      {(election.prevElectionId || election.nextElectionId) && (
        <div className="mb-4 flex flex-wrap items-center gap-2">
          {election.prevElectionId ? (
            <Link
              href={buildElectionUrl(election.prevElectionId)}
              className="flex items-center gap-1 rounded-lg border border-card-border bg-card px-3 py-1.5 text-sm text-muted hover:text-foreground hover:bg-card-elevated transition-colors"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M15 19l-7-7 7-7"
                />
              </svg>
              Previous
            </Link>
          ) : (
            <span className="flex items-center gap-1 rounded-lg border border-card-border bg-card px-3 py-1.5 text-sm text-muted/50 cursor-not-allowed">
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M15 19l-7-7 7-7"
                />
              </svg>
              Previous
            </span>
          )}
          {election.nextElectionId ? (
            <Link
              href={buildElectionUrl(election.nextElectionId)}
              className="flex items-center gap-1 rounded-lg border border-card-border bg-card px-3 py-1.5 text-sm text-muted hover:text-foreground hover:bg-card-elevated transition-colors"
            >
              Next
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M9 5l7 7-7 7"
                />
              </svg>
            </Link>
          ) : (
            <span className="flex items-center gap-1 rounded-lg border border-card-border bg-card px-3 py-1.5 text-sm text-muted/50 cursor-not-allowed">
              Next
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M9 5l7 7-7 7"
                />
              </svg>
            </span>
          )}
        </div>
      )}
    </>
  );
}
