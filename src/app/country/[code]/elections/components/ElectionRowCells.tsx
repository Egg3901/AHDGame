"use client";

/**
 * Cell renderers for one race in the grouped elections list.
 *
 * These are deliberately small and flat. The rich presentation (polling donuts,
 * primary grids, per-party tallies) lives on the election detail page and in
 * `ElectionCard`, which the region tab still uses. A country can have hundreds
 * of live races at once, so the list itself has to stay scannable.
 */

import Link from "next/link";
import { useGameClock } from "@/contexts/useGameClock";
import { getTimerUrgencyStyle } from "@/lib/utils/formatters";
import type { ElectionDisplay } from "@/lib/db/types";
import { ELECTION_STATE_NAMES, isCompetitiveElection } from "@/app/elections/electionsHelpers";
import type { EntryAction } from "@/lib/elections/entryEligibility";
import { relevantDeadlineTurn } from "../electionsSelectors";

const CLASS_ROMAN: Record<number, string> = { 1: "I", 2: "II", 3: "III" };

/** Region plus any class/seat qualifier, e.g. "Connecticut · Class I". */
export function RegionCell({ election }: { election: ElectionDisplay }) {
  const regionName = ELECTION_STATE_NAMES[election.state] ?? election.state;
  const cls = election.senateClass ?? election.chamberClass ?? null;
  const seats = election.totalSeats && election.totalSeats > 1 ? election.totalSeats : null;

  return (
    <div className="min-w-0">
      <span className="font-medium text-foreground">{regionName}</span>
      {cls != null && (
        <span className="ml-2 text-xs text-muted">Class {CLASS_ROMAN[cls] ?? cls}</span>
      )}
      {seats != null && <span className="ml-2 text-xs text-muted">{seats} seats</span>}
    </div>
  );
}

/**
 * What stage the race is at, in the player's terms.
 *
 * "Filing open" is the important one. At the start of an iteration every race
 * has zero candidates, and the old card said "No registered candidates", which
 * reads as broken rather than as an invitation.
 */
export function PhaseCell({ election }: { election: ElectionDisplay }) {
  const contested = election.candidates.length > 0;

  if (election.status === "upcoming") {
    return <Chip tone="info">Not open yet</Chip>;
  }
  if (election.status === "completed") {
    return <Chip tone="muted">Completed</Chip>;
  }
  if (election.inPrimary) {
    return contested ? (
      <Chip tone="warning">Primary</Chip>
    ) : (
      <Chip tone="success">Filing open</Chip>
    );
  }
  return contested ? <Chip tone="success">General</Chip> : <Chip tone="success">Filing open</Chip>;
}

function Chip({
  tone,
  children,
}: {
  tone: "info" | "warning" | "success" | "muted";
  children: React.ReactNode;
}) {
  const cls =
    tone === "info"
      ? "bg-info/10 border-info/25 text-info"
      : tone === "warning"
        ? "bg-warning/10 border-warning/25 text-warning"
        : tone === "success"
          ? "bg-success/10 border-success/25 text-success"
          : "bg-muted/10 border-muted/25 text-muted";
  return (
    <span
      className={`inline-flex whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-medium ${cls}`}
    >
      {children}
    </span>
  );
}

/**
 * Turn-based countdown to whichever deadline matters now.
 *
 * Turns lead, not wall-clock dates: turns freeze when the game pauses, so a date
 * can drift away from the deadline the engine will actually act on.
 */
export function DeadlineCell({ election }: { election: ElectionDisplay }) {
  const clock = useGameClock();
  const turn = relevantDeadlineTurn(election);
  if (turn == null) return <span className="text-xs text-muted">No deadline</span>;

  const timer = clock.formatRemainingTurns(turn);
  const label = election.inPrimary ? "Primary closes" : "Voting closes";

  return (
    <div className="min-w-0">
      <div className={`text-sm font-medium tabular-nums ${getTimerUrgencyStyle(timer.urgency)}`}>
        {timer.text}
      </div>
      <div className="text-[10px] uppercase tracking-wider text-muted">{label}</div>
    </div>
  );
}

/** Candidate count, or the leader when polling exists. */
export function FieldCell({ election }: { election: ElectionDisplay }) {
  const count = election.candidates.length;
  const leaderId = election.polling?.leaderId ?? null;

  if (count === 0) {
    return <span className="text-sm text-muted">Nobody yet</span>;
  }

  if (leaderId) {
    const share = election.polling?.sharesPct?.[leaderId];
    const color = election.polling?.candidatePartyColors?.[leaderId] ?? "var(--muted)";
    return (
      <div className="flex min-w-0 items-center gap-2">
        <span
          className="h-2.5 w-2.5 shrink-0 rounded-full"
          style={{ backgroundColor: color }}
          aria-hidden
        />
        <span className="truncate text-sm text-foreground">
          {election.polling?.leaderName ?? "Leading"}
        </span>
        {typeof share === "number" && (
          <span className="shrink-0 text-xs tabular-nums text-muted">{share.toFixed(0)}%</span>
        )}
        {isCompetitiveElection(election) && (
          <span className="shrink-0 text-xs text-warning" title="Top two within 15 points">
            Close
          </span>
        )}
      </div>
    );
  }

  return (
    <span className="text-sm text-foreground">
      {count} candidate{count === 1 ? "" : "s"}
    </span>
  );
}

/** Enter, withdraw, or a link through to the full race. */
export function RaceActions({
  election,
  href,
  action,
  isLoading,
  onEnter,
  onWithdraw,
}: {
  election: ElectionDisplay;
  href: string;
  action: EntryAction;
  isLoading: boolean;
  onEnter: (electionId: string) => void;
  onWithdraw: (electionId: string) => void;
}) {
  return (
    <div className="flex items-center justify-end gap-2">
      <Link
        href={href}
        className="rounded-lg border border-card-border px-2.5 py-1.5 text-xs font-medium text-muted transition-colors hover:text-foreground"
      >
        View
      </Link>
      {action === "withdraw" && (
        <button
          onClick={() => onWithdraw(election.id)}
          disabled={isLoading}
          className="rounded-lg border border-error/40 bg-error/10 px-2.5 py-1.5 text-xs font-medium text-error transition-colors hover:bg-error/20 disabled:opacity-40"
        >
          {isLoading ? "Working" : "Withdraw"}
        </button>
      )}
      {action === "enter" && (
        <button
          onClick={() => onEnter(election.id)}
          disabled={isLoading}
          className="rounded-lg border border-primary/40 bg-primary/10 px-2.5 py-1.5 text-xs font-medium text-primary transition-colors hover:bg-primary/20 disabled:opacity-40"
        >
          {isLoading ? "Joining" : "Enter race"}
        </button>
      )}
      {action === "blocked" && (
        <span
          className="text-xs italic text-muted"
          title="Resolution for this race type is still being built, so it resolves vacant for now"
        >
          Filing closed
        </span>
      )}
    </div>
  );
}
