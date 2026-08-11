"use client";

import BackButton from "@/components/BackButton";
import type { ElectionResultsResponse } from "@/lib/elections/liveResults/types";
import { LiveTurnBadge } from "./LiveTurnBadge";
import { ResultsProgressBar } from "./ResultsProgressBar";
import { ResultsViewRouter } from "./ResultsViewRouter";
import { timeAgoLabel } from "./resultsFormat";

const TYPE_TITLES: Record<string, string> = {
  president: "Presidential Election",
  senate: "Senate Election",
  house: "House Election",
  stateSenate: "State Senate Election",
  governor: "Governor's Race",
  commons: "General Election",
  snap_commons: "Snap General Election",
  primeMinister: "Prime Minister",
  holyrood: "Scottish Parliament Election",
  senedd: "Senedd Election",
  regionalCouncil: "Regional Council Election",
  shugiin: "Shūgiin Election",
  snap_shugiin: "Snap Shūgiin Election",
  sangiin: "Sangiin Election",
  bundestag: "Bundestag Election",
  landtag: "Landtag Election",
  chancellor: "Chancellor",
  ministerPresident: "Minister-President",
  dail: "Dáil Election",
  seanad: "Seanad Election",
  uachtaran: "Presidential Election",
  npcDelegate: "NPC Delegate Election",
  peoplesCongress: "People's Congress Election",
};

const UNIT_LABELS: Record<string, string> = {
  president: "states",
};

interface LiveResultsShellProps {
  data: ElectionResultsResponse;
  lastFetchedAt: Date | null;
  simulating: boolean;
  onStartSimulation: () => void;
  onStopSimulation: () => void;
}

/** Page chrome: breadcrumb, title + live badge, progress strip, view router. */
export function LiveResultsShell({
  data,
  lastFetchedAt,
  simulating,
  onStartSimulation,
  onStopSimulation,
}: LiveResultsShellProps) {
  const { election, summary } = data;
  const isLive = election.status === "active";
  const title = `${election.electionYear ?? ""} ${
    TYPE_TITLES[election.electionType] ?? "Election"
  }`.trim();
  const updatedAgo = timeAgoLabel(lastFetchedAt);

  return (
    <div className="min-h-screen bg-background">
      <main className="mx-auto max-w-6xl space-y-4 px-4 py-6 sm:px-6 sm:py-8">
        <div className="flex items-center gap-2 text-sm">
          <BackButton fallbackLabel="Back to Election" fallbackHref={`/elections/${election.id}`} />
          <span className="text-card-border">/</span>
          <span className="font-medium">Live Results</span>
        </div>

        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-bold sm:text-3xl">{title}</h1>
            <LiveTurnBadge
              status={election.status}
              currentTurn={election.currentTurn}
              endTurn={election.endTurn}
              finalHourProgress={election.finalHour?.progress ?? null}
            />
          </div>
          <div className="flex items-center gap-3">
            {updatedAgo && !simulating && (
              <span className="text-xs text-muted">Updated {updatedAgo}</span>
            )}
            {data.isAdmin && !simulating && (
              <button
                type="button"
                onClick={onStartSimulation}
                className="rounded-lg border border-warning/50 bg-warning/10 px-3 py-1.5 text-xs font-medium text-warning transition-colors hover:bg-warning/20"
                title="Admin only: replay a simulated election night with test data"
              >
                ▶ Simulate results
              </button>
            )}
          </div>
        </div>

        {simulating && (
          <div className="flex items-center justify-between gap-3 rounded-xl border border-warning/50 bg-warning/10 px-4 py-2.5">
            <span className="inline-flex items-center gap-2 text-sm font-semibold text-warning">
              <span className="h-2 w-2 animate-pulse rounded-full bg-warning" />
              SIMULATION — test data, not real results
            </span>
            <button
              type="button"
              onClick={onStopSimulation}
              className="rounded-lg border border-warning/50 px-3 py-1 text-xs font-medium text-warning transition-colors hover:bg-warning/20"
            >
              Exit simulation
            </button>
          </div>
        )}

        {election.status === "upcoming" && !simulating ? (
          <div className="rounded-xl border border-card-border bg-card p-8 text-center">
            <p className="text-sm font-medium">This election has not begun.</p>
            {election.startTurn != null && (
              <p className="mt-1 text-xs text-muted tabular-nums">
                Voting opens on turn {election.startTurn} (now turn {election.currentTurn}).
              </p>
            )}
          </div>
        ) : summary.totalVotes === 0 && !simulating ? (
          <div className="rounded-xl border border-card-border bg-card p-8 text-center">
            <p className="text-sm font-medium">Votes are being counted…</p>
            <p className="mt-1 text-xs text-muted">
              Results will appear here as the first returns come in.
            </p>
          </div>
        ) : (
          <>
            <ResultsProgressBar
              unitsReporting={summary.unitsReporting}
              totalUnits={summary.totalUnits}
              unitsCalled={summary.unitsCalled}
              unitLabel={UNIT_LABELS[election.electionType] ?? "races"}
              isLive={isLive}
            />
            <ResultsViewRouter data={data} />
          </>
        )}
      </main>
    </div>
  );
}
