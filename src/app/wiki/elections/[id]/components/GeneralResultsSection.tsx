"use client";

import React from "react";
import { SectionLabel } from "@/components/ui";
import { formatPct } from "../wikiElectionHelpers";
import type { GeneralResults } from "../wikiElectionTypes";

interface GeneralResultsSectionProps {
  electionType: string;
  generalResults: GeneralResults;
  totalVotes: number;
}

export function GeneralResultsSection({
  electionType,
  generalResults,
  totalVotes,
}: GeneralResultsSectionProps) {
  const rows = Object.entries(generalResults.candidateNames)
    .map(([candId, name]) => {
      const votes = generalResults.totalVotes[candId] ?? 0;
      const pct = totalVotes > 0 ? (votes / totalVotes) * 100 : 0;
      const party = generalResults.candidateParties[candId] ?? "-";
      const seats = generalResults.seatsEstimate?.[candId];
      return {
        candId,
        name,
        party,
        votes,
        pct,
        seats,
      };
    })
    .sort((a, b) => b.votes - a.votes);

  return (
    <section className="mb-10 rounded-xl border border-card-border bg-card/40 p-6 shadow-panel">
      <SectionLabel as="h3">
        {electionType === "president" ? "Popular Vote Summary" : "General Election Results"}
      </SectionLabel>
      <p className="mb-4 text-sm text-muted">
        {electionType === "president"
          ? "National popular vote totals aggregated across all states and districts."
          : "Final vote totals and seat allocation by candidate."}
      </p>

      <div className="mb-5 space-y-3">
        {rows.slice(0, 6).map((row, index) => (
          <div key={`bar-${row.candId}`}>
            <div className="mb-1 flex items-center justify-between gap-3 text-xs">
              <span className="truncate font-medium text-foreground">
                {row.name} ({row.party})
              </span>
              <span className="font-mono text-muted">{formatPct(row.pct)}</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-card-elevated">
              <div
                className="h-full rounded-full bg-primary"
                style={{
                  width: `${Math.max(row.pct, row.votes > 0 ? 1 : 0)}%`,
                  opacity: Math.max(0.45, 1 - index * 0.08),
                }}
              />
            </div>
          </div>
        ))}
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-card-elevated">
            <tr className="border-b border-card-border text-left">
              <th className="pb-2 pr-4 font-medium text-foreground">Candidate</th>
              <th className="pb-2 pr-4 font-medium text-foreground">Party</th>
              <th className="pb-2 pr-4 font-medium text-foreground">Votes</th>
              <th className="pb-2 font-medium text-foreground">Share</th>
              {generalResults.seatsEstimate &&
                Object.keys(generalResults.seatsEstimate).length > 0 && (
                  <th className="pb-2 font-medium text-foreground">Seats</th>
                )}
            </tr>
          </thead>
          <tbody>
            {Object.entries(generalResults.candidateNames)
              .map(([candId, name]) => {
                const votes = generalResults.totalVotes[candId] ?? 0;
                const pct = totalVotes > 0 ? (votes / totalVotes) * 100 : 0;
                const party = generalResults.candidateParties[candId] ?? "—";
                const seats = generalResults.seatsEstimate?.[candId];
                return {
                  candId,
                  name,
                  party,
                  votes,
                  pct,
                  seats,
                };
              })
              .sort((a, b) => b.votes - a.votes)
              .map((row) => (
                <tr
                  key={row.candId}
                  className="border-b border-card-border/50 last:border-0 hover:bg-card-elevated/30 transition-colors"
                >
                  <td className="py-2 pr-4 font-medium text-foreground">{row.name}</td>
                  <td className="py-2 pr-4 text-muted">{row.party}</td>
                  <td className="py-2 pr-4 text-muted">{row.votes.toLocaleString("en-US")}</td>
                  <td className="py-2 text-muted">{formatPct(row.pct)}</td>
                  {generalResults.seatsEstimate &&
                    Object.keys(generalResults.seatsEstimate).length > 0 && (
                      <td className="py-2 text-foreground">{row.seats ?? "—"}</td>
                    )}
                </tr>
              ))}
          </tbody>
        </table>
      </div>

      <div className="mt-4 rounded-lg bg-card-elevated/40 p-3">
        <p className="text-sm text-muted">
          <span className="font-medium text-foreground">Total votes cast:</span>{" "}
          {totalVotes.toLocaleString("en-US")}
          {generalResults.finalized && (
            <span className="ml-3 inline-flex items-center rounded-full bg-success/10 px-2 py-0.5 text-xs font-medium text-success border border-success/20">
              Finalized
            </span>
          )}
        </p>
      </div>
    </section>
  );
}
