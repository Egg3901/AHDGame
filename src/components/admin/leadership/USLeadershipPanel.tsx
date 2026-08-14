"use client";

import { useState, useEffect, useCallback } from "react";
import { EmptyState } from "@/components/ui";
import { LocalTime } from "@/components/time/LocalTime";

interface Candidate {
  id: string;
  name: string;
  party: string | null;
  status: string;
  votesFor: number;
  votesAgainst: number;
}

interface ElectionRow {
  id: string;
  role: string;
  roleLabel: string;
  status: string;
  startedAt: string | null;
  endsAt: string | null;
  candidates: Candidate[];
}

const STATUS_COLORS: Record<string, string> = {
  voting: "bg-yellow-500/20 text-yellow-400",
  closed: "bg-muted/20 text-muted",
  cancelled: "bg-muted/20 text-muted",
  confirmed: "bg-emerald-500/20 text-emerald-400",
  failed: "bg-red-500/20 text-red-400",
};

const TABS = [
  { id: "speaker", label: "Speaker" },
  { id: "house_leadership", label: "House Leadership" },
  { id: "senate_leadership", label: "Senate Leadership" },
] as const;

type TabId = (typeof TABS)[number]["id"];

function activeElectionCandidates(e: ElectionRow): Candidate[] {
  return e.candidates.filter((c) => c.status === "open" || c.status === "voting");
}

export function USLeadershipPanel() {
  const [innerTab, setInnerTab] = useState<TabId>("speaker");
  const [elections, setElections] = useState<ElectionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [passTarget, setPassTarget] = useState<string | null>(null);
  const [selectedWinner, setSelectedWinner] = useState("");

  const fetchElections = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/leadership-elections?type=${innerTab}`);
      if (res.ok) {
        const data = await res.json();
        setElections(data.elections || []);
      }
    } finally {
      setLoading(false);
    }
  }, [innerTab]);

  useEffect(() => {
    fetchElections();
  }, [fetchElections]);

  useEffect(() => {
    setPassTarget(null);
    setSelectedWinner("");
    setMessage("");
  }, [innerTab]);

  const runAction = async (electionId: string, role: string, action: string, winnerId?: string) => {
    setMessage("");
    const res = await fetch("/api/admin/leadership-elections", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: innerTab,
        action,
        electionId,
        role,
        ...(winnerId ? { winnerId } : {}),
      }),
    });
    const d = await res.json();
    setMessage(res.ok ? d.message : `Error: ${d.error}`);
    if (res.ok) {
      setPassTarget(null);
      setSelectedWinner("");
      fetchElections();
    }
  };

  return (
    <div className="space-y-4">
      {/* Inner tab bar */}
      <div
        role="tablist"
        className="flex gap-1 rounded-lg border border-card-border bg-background p-1 w-fit"
      >
        {TABS.map((t) => (
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

      {/* Message banner */}
      {message && (
        <div
          className={`rounded-lg border px-4 py-2 text-sm ${
            message.startsWith("Error")
              ? "border-red-500/30 bg-red-500/10 text-red-400"
              : "border-green-500/30 bg-green-500/10 text-green-400"
          }`}
        >
          {message}
        </div>
      )}

      {/* Content */}
      {loading ? (
        <div className="rounded-xl border border-card-border bg-card p-6 text-center text-sm text-muted">
          Loading leadership elections...
        </div>
      ) : elections.length === 0 ? (
        <div className="rounded-xl border border-card-border bg-card p-6">
          <EmptyState
            title="No leadership elections"
            description="Leadership elections will appear here when active."
          />
        </div>
      ) : (
        <div className="space-y-3">
          {elections.map((e) => (
            <div key={e.id} className="rounded-xl border border-card-border bg-card p-4 space-y-3">
              <div className="flex items-start gap-3 flex-wrap">
                <div className="flex-1 min-w-0">
                  {/* Role label + status badge */}
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-sm">{e.roleLabel}</span>
                    <span
                      className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                        STATUS_COLORS[e.status] ?? "bg-muted/20 text-muted"
                      }`}
                    >
                      {e.status}
                    </span>
                  </div>

                  {/* Deadline */}
                  {e.endsAt && (
                    <p className="text-xs text-muted mt-1">
                      Ends:{" "}
                      <span className="text-yellow-400">
                        <LocalTime value={e.endsAt} />
                      </span>
                    </p>
                  )}

                  {/* Candidate list */}
                  {e.candidates.length > 0 && (
                    <div className="mt-2 space-y-1">
                      {e.candidates.map((c) => (
                        <div key={c.id} className="text-xs text-muted flex items-center gap-1.5">
                          <span className="text-foreground">{c.name}</span>
                          {c.party && <span>({c.party})</span>}
                          <span>&mdash;</span>
                          <span className="text-emerald-400">{c.votesFor}</span>
                          <span className="text-red-400">{c.votesAgainst}</span>
                          <span
                            className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ${
                              STATUS_COLORS[c.status] ?? "bg-muted/20 text-muted"
                            }`}
                          >
                            {c.status}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Action buttons */}
                {e.status === "voting" && (
                  <div className="flex flex-wrap gap-2 shrink-0 items-start">
                    {passTarget === e.id ? (
                      <div className="flex items-center gap-2">
                        <select
                          value={selectedWinner}
                          onChange={(ev) => setSelectedWinner(ev.target.value)}
                          className="rounded-lg border border-card-border bg-card px-2 py-1 text-xs text-foreground"
                        >
                          <option value="">Pick winner...</option>
                          {activeElectionCandidates(e).map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.name}
                              {c.party ? ` (${c.party})` : ""}
                            </option>
                          ))}
                        </select>
                        <button
                          disabled={!selectedWinner}
                          onClick={() => runAction(e.id, e.role, "pass", selectedWinner)}
                          className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-1.5 text-xs font-medium text-emerald-400 hover:bg-emerald-500/20 transition-colors disabled:opacity-40"
                        >
                          Confirm
                        </button>
                        <button
                          onClick={() => {
                            setPassTarget(null);
                            setSelectedWinner("");
                          }}
                          className="rounded-lg border border-card-border bg-muted/10 px-2 py-1.5 text-xs font-medium text-muted hover:bg-muted/20 transition-colors"
                        >
                          &#10005;
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => setPassTarget(e.id)}
                        className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-1.5 text-xs font-medium text-emerald-400 hover:bg-emerald-500/20 transition-colors"
                      >
                        Pass
                      </button>
                    )}
                    <button
                      onClick={() => runAction(e.id, e.role, "fail")}
                      className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-1.5 text-xs font-medium text-red-400 hover:bg-red-500/20 transition-colors"
                    >
                      Fail
                    </button>
                    <button
                      onClick={() => runAction(e.id, e.role, "cancel")}
                      className="rounded-lg border border-card-border bg-muted/10 px-3 py-1.5 text-xs font-medium text-muted hover:bg-muted/20 transition-colors"
                    >
                      Cancel
                    </button>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
