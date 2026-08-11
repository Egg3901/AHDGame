"use client";

import React from "react";
import { formatDate, typeLabel } from "../wikiElectionHelpers";
import type { ElectionDetail } from "../wikiElectionTypes";

interface ElectionInfoBoxProps {
  election: ElectionDetail;
  totalVotes: number;
}

export function ElectionInfoBox({ election, totalVotes }: ElectionInfoBoxProps) {
  return (
    <aside className="mb-8 float-right ml-6 w-80 rounded-xl border-2 border-card-border bg-gradient-to-b from-card/80 to-card/60 p-5 shadow-lg backdrop-blur-sm">
      <h2 className="mb-4 border-b-2 border-primary/30 pb-2 text-sm font-bold uppercase tracking-wider text-foreground">
        {election.label}
      </h2>
      <dl className="space-y-3 text-sm">
        <div className="flex justify-between items-baseline">
          <dt className="font-semibold text-muted">Date</dt>
          <dd className="text-foreground font-medium">{formatDate(election.endTime)}</dd>
        </div>
        <div className="flex justify-between items-baseline">
          <dt className="font-semibold text-muted">Cycle</dt>
          <dd className="text-foreground font-medium">{election.cycle}</dd>
        </div>
        <div className="flex justify-between items-baseline">
          <dt className="font-semibold text-muted">Type</dt>
          <dd className="text-foreground font-medium">{typeLabel(election.electionType)}</dd>
        </div>
        {election.electionType !== "president" && (
          <div className="flex justify-between items-baseline">
            <dt className="font-semibold text-muted">Location</dt>
            <dd className="text-foreground font-medium">{election.stateName}</dd>
          </div>
        )}
        {election.senateClass && (
          <div className="flex justify-between items-baseline">
            <dt className="font-semibold text-muted">Senate Class</dt>
            <dd className="text-foreground font-medium">{election.senateClass}</dd>
          </div>
        )}
        {election.totalSeats && (
          <div className="flex justify-between items-baseline">
            <dt className="font-semibold text-muted">Seats</dt>
            <dd className="text-foreground font-medium">{election.totalSeats}</dd>
          </div>
        )}
        {totalVotes > 0 && (
          <div className="flex justify-between items-baseline">
            <dt className="font-semibold text-muted">Total Votes</dt>
            <dd className="text-foreground font-medium">{totalVotes.toLocaleString("en-US")}</dd>
          </div>
        )}
        {election.generalResults?.finalized && (
          <div className="mt-4 pt-3 border-t border-card-border">
            <div className="flex items-center justify-center gap-2 rounded-lg bg-success/10 border border-success/25 px-3 py-2">
              <span className="text-success text-xs font-bold">✓ FINALIZED</span>
            </div>
          </div>
        )}
      </dl>
    </aside>
  );
}
