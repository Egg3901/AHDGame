"use client";

import React from "react";
import Link from "next/link";
import { typeLabel } from "../wikiElectionHelpers";
import type { ElectionDetail } from "../wikiElectionTypes";

interface ElectionFooterProps {
  election: ElectionDetail;
}

export function ElectionFooter({ election }: ElectionFooterProps) {
  return (
    <footer className="mt-12 border-t border-card-border pt-6 pb-4">
      <h3 className="mb-4 text-base font-semibold text-foreground">See Also</h3>
      <div className="space-y-3">
        <div>
          <p className="mb-2 text-xs font-medium uppercase tracking-wider text-muted/70">
            Navigation
          </p>
          <div className="flex flex-wrap gap-2">
            <Link
              href="/wiki/elections"
              className="rounded-lg border border-card-border bg-card/40 px-3 py-1.5 text-sm text-muted transition-colors hover:border-primary/40 hover:text-primary hover:bg-card/60"
            >
              ← Election History
            </Link>
            <Link
              href={`/wiki/elections/browse/${election.year}/${election.electionType}`}
              className="rounded-lg border border-card-border bg-card/40 px-3 py-1.5 text-sm text-muted transition-colors hover:border-primary/40 hover:text-primary hover:bg-card/60"
            >
              {election.year} {typeLabel(election.electionType, true)}
            </Link>
            {election.electionType !== "president" && (
              <Link
                href={`/wiki/elections/browse/${election.state}/${election.electionType}`}
                className="rounded-lg border border-card-border bg-card/40 px-3 py-1.5 text-sm text-muted transition-colors hover:border-primary/40 hover:text-primary hover:bg-card/60"
              >
                {election.stateName} {typeLabel(election.electionType)}
              </Link>
            )}
          </div>
        </div>
        <div>
          <p className="mb-2 text-xs font-medium uppercase tracking-wider text-muted/70">
            Related Topics
          </p>
          <div className="flex flex-wrap gap-2">
            <Link
              href="/wiki/election-mechanics"
              className="rounded-lg border border-card-border bg-card/40 px-3 py-1.5 text-sm text-muted transition-colors hover:border-primary/40 hover:text-primary hover:bg-card/60"
            >
              Election Mechanics
            </Link>
            {election.electionType !== "president" && (
              <Link
                href={`/wiki/state/${election.state}`}
                className="rounded-lg border border-card-border bg-card/40 px-3 py-1.5 text-sm text-muted transition-colors hover:border-primary/40 hover:text-primary hover:bg-card/60"
              >
                {election.stateName}
              </Link>
            )}
            <Link
              href="/wiki/parties"
              className="rounded-lg border border-card-border bg-card/40 px-3 py-1.5 text-sm text-muted transition-colors hover:border-primary/40 hover:text-primary hover:bg-card/60"
            >
              Political Parties
            </Link>
          </div>
        </div>
      </div>
      <div className="mt-6 pt-4 border-t border-card-border/50">
        <p className="text-xs text-muted/60 text-center">
          This article is part of the A House Divided wiki. All election data reflects in-game
          historical records.
        </p>
      </div>
    </footer>
  );
}
