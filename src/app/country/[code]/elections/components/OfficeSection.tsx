"use client";

/**
 * One collapsible office group: Senate, House, Governor, and so on.
 *
 * The header carries the numbers that matter before anything is opened — how
 * many races, how many have anyone standing, and when the soonest one closes.
 * That is what makes a 251-race country readable without scrolling.
 */

import { useMemo } from "react";
import { useGameClock } from "@/contexts/useGameClock";
import { ResponsiveTable, type ResponsiveTableColumn } from "@/components/ui";
import type { CharacterBasic, ElectionDisplay } from "@/lib/db/types";
import { buildElectionHref } from "@/app/elections/electionsHelpers";
import { resolveEntryAction } from "@/lib/elections/entryEligibility";
import type { OfficeSection as OfficeSectionModel } from "../electionsSelectors";
import { DeadlineCell, FieldCell, PhaseCell, RaceActions, RegionCell } from "./ElectionRowCells";

interface OfficeSectionProps {
  section: OfficeSectionModel;
  regionLabel: string;
  expanded: boolean;
  onToggle: (key: string) => void;
  character: CharacterBasic | null;
  isInRace: (election: ElectionDisplay) => boolean;
  isInAnyRace: () => boolean;
  actionLoading: string | null;
  onEnterRace: (electionId: string) => void;
  onWithdraw: (electionId: string) => void;
  /**
   * Extra content under the table for this section, e.g. the UK Commons
   * carve-up panels. Kept out of the rows so per-race detail cannot undo the
   * density this layout exists for.
   */
  footer?: React.ReactNode;
}

export function OfficeSection({
  section,
  regionLabel,
  expanded,
  onToggle,
  character,
  isInRace,
  isInAnyRace,
  actionLoading,
  onEnterRace,
  onWithdraw,
  footer,
}: OfficeSectionProps) {
  const clock = useGameClock();
  const inAnyRace = isInAnyRace();

  const columns = useMemo<ResponsiveTableColumn<ElectionDisplay>[]>(
    () => [
      {
        key: "region",
        header: regionLabel,
        render: (e) => <RegionCell election={e} />,
      },
      {
        key: "phase",
        header: "Stage",
        mobileLabel: "Stage",
        render: (e) => <PhaseCell election={e} />,
      },
      {
        key: "field",
        header: "Standing",
        mobileLabel: "Standing",
        render: (e) => <FieldCell election={e} />,
      },
      {
        key: "deadline",
        header: "Closes",
        mobileLabel: "Closes",
        render: (e) => <DeadlineCell election={e} />,
      },
    ],
    [regionLabel]
  );

  const renderActions = (e: ElectionDisplay) => {
    // The primary countdown comes from the game clock, not the server payload:
    // the elections API and the turn-status API are fetched separately and can
    // disagree for a few seconds after a turn.
    const primaryTimer =
      e.primaryEndTurn != null
        ? clock.formatRemainingTurns(e.primaryEndTurn)
        : clock.formatRemaining(e.primaryEndTime);
    const action = resolveEntryAction({
      election: e,
      character,
      stateId: e.state,
      inThisRace: isInRace(e),
      inAnyRace,
      primaryEnded: primaryTimer.urgency === "ended",
    });
    return (
      <RaceActions
        election={e}
        href={buildElectionHref(e)}
        action={action}
        isLoading={actionLoading === e.id}
        onEnter={onEnterRace}
        onWithdraw={onWithdraw}
      />
    );
  };

  const deadline =
    section.nextDeadlineTurn != null
      ? clock.formatRemainingTurns(section.nextDeadlineTurn).text
      : null;
  const panelId = `office-section-${section.key}`;

  return (
    <section className="space-y-3">
      <button
        type="button"
        onClick={() => onToggle(section.key)}
        aria-expanded={expanded}
        aria-controls={panelId}
        className="flex w-full items-center gap-3 rounded-xl border border-card-border bg-card px-4 py-3 text-left transition-colors hover:border-primary/40"
      >
        <svg
          className={`h-4 w-4 shrink-0 text-muted transition-transform ${expanded ? "rotate-90" : ""}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          aria-hidden
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
        </svg>

        <span className="min-w-0 flex-1">
          <span className="block truncate text-base font-bold tracking-tight text-foreground">
            {section.label}
          </span>
          <span className="mt-0.5 block text-xs text-muted">
            {section.total} race{section.total === 1 ? "" : "s"}
            <span className="mx-1.5 opacity-50">·</span>
            {section.contested} contested
            {section.competitive > 0 && (
              <>
                <span className="mx-1.5 opacity-50">·</span>
                <span className="text-warning">{section.competitive} close</span>
              </>
            )}
          </span>
        </span>

        {deadline && (
          <span className="shrink-0 text-right">
            <span className="block text-sm font-medium tabular-nums text-foreground">
              {deadline}
            </span>
            <span className="block text-[10px] uppercase tracking-wider text-muted">
              Next to close
            </span>
          </span>
        )}
      </button>

      {expanded && (
        <div id={panelId} className="space-y-4">
          <ResponsiveTable
            columns={columns}
            data={section.elections}
            keyExtractor={(e) => e.id}
            emptyMessage="No races here right now."
            renderActions={renderActions}
          />
          {footer}
        </div>
      )}
    </section>
  );
}
