"use client";

import React from "react";
import Link from "next/link";
import { PartySection } from "./ElectionDetailComponents";
import type { ElectionDetail, PartyGroup } from "./ElectionDetailTypes";

interface UpcomingElectionViewProps {
  election: ElectionDetail;
  electionId: string;
  activeParties: PartyGroup[];
  canEnter: boolean;
  actionLoading: boolean;
  onEnter: () => void;
  onRemoveSuccess: () => void;
}

export function UpcomingElectionView({
  election,
  electionId,
  activeParties,
  onRemoveSuccess,
}: UpcomingElectionViewProps) {
  return (
    <div className="space-y-4">
      {/* Previous results card — only when a prior cycle completed */}
      {election.prevElectionId && (
        <div className="rounded-xl border border-card-border bg-card p-4 flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-medium">Previous election results</p>
            <p className="text-xs text-muted mt-0.5">View how this race concluded last cycle</p>
          </div>
          <Link
            href={`/elections/${election.prevElectionId}`}
            className="shrink-0 rounded-lg border border-card-border bg-card-elevated px-3 py-1.5 text-sm text-muted hover:text-foreground hover:bg-card-elevated/80 transition-colors"
          >
            View results →
          </Link>
        </div>
      )}

      {/* Declared candidates (if any entered early) */}
      {activeParties.length > 0 ? (
        <div className="space-y-4">
          {activeParties.map((group) => (
            <PartySection
              key={group.partyId}
              group={group}
              inPrimary={false}
              snapshots={[]}
              isAdmin={election.isAdmin}
              electionId={electionId}
              isEnded={false}
              onRemoveSuccess={onRemoveSuccess}
              isPresident={election.electionType === "president"}
            />
          ))}
        </div>
      ) : (
        <div className="rounded-xl border border-dashed border-card-border p-8 text-center">
          <p className="text-sm text-muted">No candidates have declared yet.</p>
          <p className="text-xs text-muted/60 mt-1">Candidates can enter once the primary opens.</p>
        </div>
      )}
    </div>
  );
}
