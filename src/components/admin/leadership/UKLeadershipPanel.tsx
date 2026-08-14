"use client";

import { useState, useEffect, useCallback } from "react";
import { EmptyState } from "@/components/ui";
import { LocalTime } from "@/components/time/LocalTime";

interface ConfidenceVoteRow {
  id: string;
  voteType: string;
  nomineeName: string;
  party: string;
  status: string;
  votesFor: number;
  votesAgainst: number;
  threshold: number | null;
  openedAt: string | null;
  closesAt: string | null;
  closedAt: string | null;
}

interface NoConfidenceVoteRow {
  id: string;
  pmName: string;
  rulingParty: string;
  status: string;
  votesFor: number;
  votesAgainst: number;
  openedAt: string | null;
  closesAt: string | null;
  closedAt: string | null;
}

type InnerTab = "confidence_vote" | "no_confidence_vote";

const INNER_TABS: { id: InnerTab; label: string }[] = [
  { id: "confidence_vote", label: "Confidence Votes" },
  { id: "no_confidence_vote", label: "No-Confidence Votes" },
];

const STATUS_COLORS: Record<string, string> = {
  active: "bg-yellow-500/20 text-yellow-400",
  passed: "bg-emerald-500/20 text-emerald-400",
  failed: "bg-red-500/20 text-red-400",
  cancelled: "bg-muted/20 text-muted",
};

const VOTE_TYPE_LABELS: Record<string, string> = {
  majority: "Majority",
  minority_attempt: "Minority Attempt",
};

const UK_DATE_OPTS: Intl.DateTimeFormatOptions = {
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
};

function StatusBadge({ status }: { status: string }) {
  const color = STATUS_COLORS[status] ?? "bg-muted/20 text-muted";
  return (
    <span
      className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${color}`}
    >
      {status}
    </span>
  );
}

export function UKLeadershipPanel() {
  const [innerTab, setInnerTab] = useState<InnerTab>("confidence_vote");
  const [confidenceVotes, setConfidenceVotes] = useState<ConfidenceVoteRow[]>([]);
  const [noConfidenceVotes, setNoConfidenceVotes] = useState<NoConfidenceVoteRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");

  const fetchVotes = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/leadership-elections?type=${innerTab}`);
      if (res.ok) {
        const data = await res.json();
        if (innerTab === "confidence_vote") {
          setConfidenceVotes(data.votes || []);
        } else {
          setNoConfidenceVotes(data.votes || []);
        }
      }
    } finally {
      setLoading(false);
    }
  }, [innerTab]);

  useEffect(() => {
    fetchVotes();
  }, [fetchVotes]);

  const runAction = async (voteId: string, action: string) => {
    setMessage("");
    const res = await fetch("/api/admin/leadership-elections", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: innerTab, action, electionId: voteId }),
    });
    const d = await res.json();
    setMessage(res.ok ? d.message : `Error: ${d.error}`);
    if (res.ok) fetchVotes();
  };

  return (
    <div className="space-y-4">
      {/* Inner tab bar */}
      <div
        role="tablist"
        className="flex gap-1 p-1 rounded-lg bg-background border border-card-border w-fit"
      >
        {INNER_TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={innerTab === t.id}
            onClick={() => setInnerTab(t.id)}
            className={`px-3 py-1 rounded-md text-xs font-medium transition-colors whitespace-nowrap ${
              innerTab === t.id
                ? "bg-card text-foreground shadow-sm"
                : "text-muted hover:text-foreground"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Status message */}
      {message && (
        <p
          className={`text-sm ${message.startsWith("Error") ? "text-red-400" : "text-emerald-400"}`}
        >
          {message}
        </p>
      )}

      {/* Loading state */}
      {loading && <p className="text-sm text-muted">Loading...</p>}

      {/* Content */}
      {!loading && innerTab === "confidence_vote" && (
        <ConfidenceVoteList votes={confidenceVotes} onAction={runAction} />
      )}
      {!loading && innerTab === "no_confidence_vote" && (
        <NoConfidenceVoteList votes={noConfidenceVotes} onAction={runAction} />
      )}
    </div>
  );
}

function ActionButtons({
  status,
  id,
  onAction,
}: {
  status: string;
  id: string;
  onAction: (id: string, action: string) => void;
}) {
  if (status !== "active") return null;
  return (
    <div className="flex gap-2 flex-shrink-0">
      <button
        onClick={() => onAction(id, "pass")}
        className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-1.5 text-xs font-medium text-emerald-400 hover:bg-emerald-500/20 transition-colors"
      >
        Pass
      </button>
      <button
        onClick={() => onAction(id, "fail")}
        className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-1.5 text-xs font-medium text-red-400 hover:bg-red-500/20 transition-colors"
      >
        Fail
      </button>
      <button
        onClick={() => onAction(id, "cancel")}
        className="rounded-lg border border-card-border bg-muted/10 px-3 py-1.5 text-xs font-medium text-muted hover:bg-muted/20 transition-colors"
      >
        Cancel
      </button>
    </div>
  );
}

function ConfidenceVoteList({
  votes,
  onAction,
}: {
  votes: ConfidenceVoteRow[];
  onAction: (id: string, action: string) => void;
}) {
  if (votes.length === 0) {
    return <EmptyState title="No confidence votes" description="No confidence votes found." />;
  }

  return (
    <div className="space-y-3">
      {votes.map((v) => (
        <div key={v.id} className="rounded-xl border border-card-border bg-card p-4 space-y-2">
          <div className="flex items-start gap-3 flex-wrap">
            <div className="flex-1 min-w-0">
              {/* Title row */}
              <div className="flex items-center gap-2 mb-1">
                <span className="text-sm font-semibold text-foreground">
                  {VOTE_TYPE_LABELS[v.voteType] ?? v.voteType}
                </span>
                <StatusBadge status={v.status} />
              </div>

              {/* Nominee */}
              <p className="text-xs text-muted">
                <span className="text-foreground font-medium">{v.nomineeName}</span> &mdash;{" "}
                {v.party}
              </p>

              {/* Votes */}
              <p className="text-xs text-muted mt-1">
                <span className="text-emerald-400">&#10003; {v.votesFor}</span>{" "}
                <span className="text-red-400">&#10007; {v.votesAgainst}</span>
                {v.threshold != null && (
                  <span className="ml-2 text-muted">Threshold: {v.threshold}</span>
                )}
              </p>

              {/* Date */}
              <p className="text-[11px] text-muted mt-1">
                {v.status === "active" && v.closesAt ? (
                  <>
                    Deadline: <LocalTime value={v.closesAt} options={UK_DATE_OPTS} />
                  </>
                ) : v.closedAt ? (
                  <>
                    Closed: <LocalTime value={v.closedAt} options={UK_DATE_OPTS} />
                  </>
                ) : v.openedAt ? (
                  <>
                    Opened: <LocalTime value={v.openedAt} options={UK_DATE_OPTS} />
                  </>
                ) : null}
              </p>
            </div>

            <ActionButtons status={v.status} id={v.id} onAction={onAction} />
          </div>
        </div>
      ))}
    </div>
  );
}

function NoConfidenceVoteList({
  votes,
  onAction,
}: {
  votes: NoConfidenceVoteRow[];
  onAction: (id: string, action: string) => void;
}) {
  if (votes.length === 0) {
    return (
      <EmptyState title="No no-confidence votes" description="No no-confidence votes found." />
    );
  }

  return (
    <div className="space-y-3">
      {votes.map((v) => (
        <div key={v.id} className="rounded-xl border border-card-border bg-card p-4 space-y-2">
          <div className="flex items-start gap-3 flex-wrap">
            <div className="flex-1 min-w-0">
              {/* Title row */}
              <div className="flex items-center gap-2 mb-1">
                <span className="text-sm font-semibold text-foreground">
                  No Confidence in {v.pmName}
                </span>
                <StatusBadge status={v.status} />
              </div>

              {/* Ruling party */}
              <p className="text-xs text-muted">Ruling party: {v.rulingParty}</p>

              {/* Votes */}
              <p className="text-xs text-muted mt-1">
                <span className="text-emerald-400">&#10003; {v.votesFor}</span>{" "}
                <span className="text-red-400">&#10007; {v.votesAgainst}</span>
              </p>

              {/* Date */}
              <p className="text-[11px] text-muted mt-1">
                {v.status === "active" && v.closesAt ? (
                  <>
                    Deadline: <LocalTime value={v.closesAt} options={UK_DATE_OPTS} />
                  </>
                ) : v.closedAt ? (
                  <>
                    Closed: <LocalTime value={v.closedAt} options={UK_DATE_OPTS} />
                  </>
                ) : v.openedAt ? (
                  <>
                    Opened: <LocalTime value={v.openedAt} options={UK_DATE_OPTS} />
                  </>
                ) : null}
              </p>
            </div>

            <ActionButtons status={v.status} id={v.id} onAction={onAction} />
          </div>
        </div>
      ))}
    </div>
  );
}
