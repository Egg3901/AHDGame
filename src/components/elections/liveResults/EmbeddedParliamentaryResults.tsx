/**
 * Embeddable election-night board — shared helper path for US House, Commons,
 * Bundestag, etc. Loads via {@link useElectionNightLoad} /
 * {@link useElectionNightPoll} and renders the same `ParliamentaryResultsView`
 * as `/elections/[id]/results`.
 */
"use client";

import Link from "next/link";
import { ParliamentaryResultsView } from "@/app/elections/[id]/results/components/ParliamentaryResultsView";
import { useElectionNightLoad, useElectionNightPoll } from "@/hooks/useElectionNight";
import { electionNightTitle } from "@/lib/elections/liveResults/electionNight";
import type { ElectionResultsResponse } from "@/lib/elections/liveResults/types";

export function EmbeddedParliamentaryResults({
  electionId,
  electionType,
  title,
}: {
  electionId: string;
  /** Used for the default header when `title` is omitted. */
  electionType?: string;
  title?: string;
}) {
  const { state, reload } = useElectionNightLoad(electionId);
  const heading = title ?? (electionType ? electionNightTitle(electionType) : "Election Night");

  if (state.kind === "loading") {
    return <div className="mb-6 h-40 animate-pulse rounded-xl border border-card-border bg-card" />;
  }
  if (state.kind === "disabled") return null;
  if (state.kind === "error") {
    return (
      <div className="mb-6 rounded-xl border border-card-border bg-card p-4 text-center text-sm text-muted">
        {state.message}{" "}
        <button type="button" className="underline" onClick={reload}>
          Retry
        </button>
      </div>
    );
  }

  return (
    <EmbeddedParliamentaryResultsReady
      electionId={electionId}
      initialData={state.data}
      title={heading}
    />
  );
}

function EmbeddedParliamentaryResultsReady({
  electionId,
  initialData,
  title,
}: {
  electionId: string;
  initialData: ElectionResultsResponse;
  title: string;
}) {
  const { data } = useElectionNightPoll(electionId, initialData);

  return (
    <div className="mb-6 space-y-3">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-muted">{title}</h2>
        <Link
          href={`/elections/${electionId}/results`}
          className="text-xs font-medium text-primary hover:underline"
        >
          Full election night →
        </Link>
      </div>
      <ParliamentaryResultsView data={data} />
    </div>
  );
}
