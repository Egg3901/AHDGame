"use client";

import React, { useMemo, useState } from "react";
import { PartyLogo } from "@/components/PartyLogo";
import { Card } from "@/components/ui";
import { PartySection } from "./ElectionDetailComponents";
import { YourStandingCard } from "./YourStandingCard";
import type { ElectionDetail, PartyGroup } from "./ElectionDetailTypes";

interface PrimaryPhaseViewProps {
  election: ElectionDetail;
  electionId: string;
  activeParties: PartyGroup[];
  localInPrimary: boolean;
  localIsEnded: boolean;
  canEnter: boolean;
  actionLoading: boolean;
  advancingCount: number;
  onEnter: () => void;
  onRemoveSuccess: () => void;
}

/**
 * Compact one-line-per-party overview. Tabs show one party in depth, so this
 * keeps the cross-party comparison the old stacked-card layout gave for free.
 */
function PartyGlanceRow({
  group,
  active,
  onSelect,
}: {
  group: PartyGroup;
  active: boolean;
  onSelect: () => void;
}) {
  const leader = group.candidates[0];
  const youAreHere = group.candidates.some((c) => c.isYou);

  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={active}
      className={`flex w-full items-center gap-2 rounded-lg border px-3 py-2 text-left transition-colors ${
        active
          ? "border-primary/50 bg-primary/5"
          : "border-card-border bg-background hover:bg-card-elevated"
      }`}
      style={active ? { borderLeftWidth: 3, borderLeftColor: group.partyColor } : undefined}
    >
      <PartyLogo
        partyId={group.partyId}
        partyColor={group.partyColor}
        countryId={group.countryId}
        size="h-4 w-4"
      />
      <span className="min-w-0 flex-1 truncate text-sm font-medium">{group.partyName}</span>
      {youAreHere && (
        <span className="shrink-0 rounded-full border border-primary/40 bg-primary/20 px-1.5 py-0.5 text-[10px] text-primary">
          You
        </span>
      )}
      {leader && (
        <span className="hidden min-w-0 shrink truncate text-xs text-muted sm:inline">
          {leader.characterName}
        </span>
      )}
      <span className="shrink-0 text-xs tabular-nums text-muted">
        {group.candidates.length} filed
      </span>
    </button>
  );
}

export function PrimaryPhaseView({
  election,
  electionId,
  activeParties,
  localInPrimary,
  localIsEnded,
  canEnter,
  actionLoading,
  advancingCount,
  onEnter,
  onRemoveSuccess,
}: PrimaryPhaseViewProps) {
  // Default to the viewer's own party — that is the primary they are actually
  // running in. Spectators land on the first (largest) party.
  const myPartyId = useMemo(
    () => activeParties.find((g) => g.candidates.some((c) => c.isYou))?.partyId,
    [activeParties]
  );
  const [selectedPartyId, setSelectedPartyId] = useState<string | null>(null);
  const activePartyId = selectedPartyId ?? myPartyId ?? activeParties[0]?.partyId ?? null;
  const selected = activeParties.find((g) => g.partyId === activePartyId) ?? activeParties[0];

  if (activeParties.length === 0) {
    return (
      <Card variant="dashed" padding="lg" className="text-center">
        <div className="text-muted">No candidates have entered this race yet.</div>
        {canEnter && (
          <button
            onClick={onEnter}
            disabled={actionLoading}
            className="mt-4 rounded-lg bg-primary px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-primary/90 disabled:opacity-50"
          >
            Be the first — Enter Race
          </button>
        )}
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <YourStandingCard activeParties={activeParties} advancingCount={advancingCount} />

      {/* Party picker. Stacking every party as a full-width card made a
          multi-party primary a very long scroll where the viewer's own race
          was rarely on screen. One party in depth, all parties at a glance. */}
      {activeParties.length > 1 && (
        <div className="space-y-1.5">
          {activeParties.map((group) => (
            <PartyGlanceRow
              key={group.partyId}
              group={group}
              active={group.partyId === activePartyId}
              onSelect={() => setSelectedPartyId(group.partyId)}
            />
          ))}
        </div>
      )}

      {selected && (
        <PartySection
          key={selected.partyId}
          group={selected}
          inPrimary={localInPrimary}
          snapshots={election.snapshotHistory}
          isAdmin={election.isAdmin}
          electionId={electionId}
          isEnded={localIsEnded}
          onRemoveSuccess={onRemoveSuccess}
          isPresident={election.electionType === "president"}
          advancingCount={advancingCount}
        />
      )}
    </div>
  );
}
