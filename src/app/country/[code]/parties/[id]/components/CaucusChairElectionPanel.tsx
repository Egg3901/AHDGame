"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { getMessageStyle } from "@/lib/utils/formatters";

interface CandidateDisplay {
  id: string;
  characterId: string;
  characterName: string;
  voteCount: number;
  isCurrentHolder: boolean;
  sequentialId?: number;
}

interface ElectionDisplay {
  id: string;
  status: "voting" | "completed" | "cancelled";
  startTime: string;
  endTime: string;
  startTurn: number;
  endTurn: number;
  durationTurns: number;
  candidates: CandidateDisplay[];
  totalVotes: number;
  winnerId: string | null;
  winnerName: string | null;
}

interface CaucusElectionResponse {
  election: ElectionDisplay | null;
  currentHolder: string | null;
  canVote: boolean;
  canRun: boolean;
  userVote: { candidateId: string; candidateName: string } | null;
  isCandidate: boolean;
}

export function CaucusChairElectionPanel({
  countryCode,
  partyId,
  caucusSlug,
  caucusName,
  caucusColor,
  currentTurn,
}: {
  countryCode: string;
  partyId: string;
  caucusSlug: string;
  caucusName: string;
  caucusColor: string;
  currentTurn: number;
}) {
  const [data, setData] = useState<CaucusElectionResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [message, setMessage] = useState("");

  const baseUrl = `/api/country/${countryCode.toLowerCase()}/parties/${partyId}/caucuses/${caucusSlug}/election`;

  const fetchData = useCallback(async () => {
    try {
      const response = await fetch(baseUrl, { cache: "no-store" });
      if (response.ok) {
        setData((await response.json()) as CaucusElectionResponse);
      }
    } finally {
      setLoading(false);
    }
  }, [baseUrl]);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  async function postAction(endpoint: "enter" | "vote", body: object) {
    setActionLoading(true);
    setMessage("");
    try {
      const response = await fetch(`${baseUrl}/${endpoint}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = (await response.json()) as { message?: string; error?: string };
      setMessage(response.ok ? `✓ ${payload.message}` : `✗ ${payload.error}`);
      if (response.ok) {
        await fetchData();
      }
    } catch {
      setMessage("✗ Network error");
    } finally {
      setActionLoading(false);
    }
  }

  if (loading) {
    return (
      <div className="rounded-lg border border-card-border bg-card p-5 text-sm text-muted">
        Loading caucus election...
      </div>
    );
  }

  if (!data) {
    return (
      <div className="rounded-lg border border-card-border bg-card p-5 text-sm text-muted">
        Could not load caucus election data.
      </div>
    );
  }

  const election = data.election;
  const remainingTurns = election ? Math.max(0, election.endTurn - currentTurn) : 0;
  const handleWithdrawVote = () => {
    if (confirm("Withdraw your caucus chair vote?")) {
      void postAction("vote", { withdraw: true });
    }
  };

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-card-border bg-card p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold">Caucus Chair Election</h3>
            <p className="mt-1 text-sm text-muted">
              {`${caucusName} runs its chair election on the same 96-turn cadence as the parent party's national leadership cycle.`}
            </p>
          </div>
          <div className="text-right text-sm">
            {election?.status === "voting" ? (
              <>
                <div className="text-[11px] uppercase tracking-widest text-muted">Closes in</div>
                <div
                  className={`font-bold tabular-nums ${
                    remainingTurns <= 12
                      ? "text-error"
                      : remainingTurns <= 24
                        ? "text-warning"
                        : "text-foreground"
                  }`}
                >
                  {remainingTurns}t
                </div>
              </>
            ) : (
              <>
                <div className="text-[11px] uppercase tracking-widest text-muted">Status</div>
                <div className="font-semibold text-muted">
                  {election?.status ?? "No election yet"}
                </div>
              </>
            )}
          </div>
        </div>

        {message && (
          <div className={`mt-4 rounded-lg p-2.5 text-xs ${getMessageStyle(message)}`}>
            {message}
          </div>
        )}

        {election?.status === "voting" && (
          <div className="mt-4 flex flex-wrap gap-2">
            {!data.isCandidate && data.canRun && (
              <button
                type="button"
                onClick={() => void postAction("enter", {})}
                disabled={actionLoading}
                className="rounded-lg px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:opacity-90 disabled:opacity-40"
                style={{ backgroundColor: caucusColor }}
              >
                {actionLoading ? "..." : "Run for Chair"}
              </button>
            )}
            {data.isCandidate && (
              <button
                type="button"
                onClick={() => void postAction("enter", { withdraw: true })}
                disabled={actionLoading}
                className="rounded-lg border border-error/40 bg-error/10 px-3 py-1.5 text-xs font-semibold text-error hover:bg-error/20 disabled:opacity-40"
              >
                {actionLoading ? "..." : "Withdraw"}
              </button>
            )}
            {data.canVote && data.userVote && (
              <button
                type="button"
                onClick={handleWithdrawVote}
                disabled={actionLoading}
                className="rounded-lg border border-error/40 bg-error/10 px-3 py-1.5 text-xs font-semibold text-error hover:bg-error/20 disabled:opacity-40"
              >
                {actionLoading ? "..." : "Withdraw Vote"}
              </button>
            )}
          </div>
        )}
      </div>

      {!election ? (
        <div className="rounded-lg border border-card-border bg-card p-5 text-sm italic text-muted">
          No caucus chair election has opened yet for this caucus.
        </div>
      ) : election.candidates.length === 0 ? (
        <div className="rounded-lg border border-card-border bg-card p-5 text-sm italic text-muted">
          No candidates have declared yet.
        </div>
      ) : (
        <div className="rounded-lg border border-card-border bg-card p-5">
          <div className="space-y-2">
            {election.candidates.map((candidate) => {
              const isMyVote = data.userVote?.candidateId === candidate.characterId;
              const pct =
                election.totalVotes > 0
                  ? Math.round((candidate.voteCount / election.totalVotes) * 100)
                  : 0;

              return (
                <div
                  key={candidate.id}
                  className={`rounded-lg border p-3 ${isMyVote ? "border-2" : "border-card-border"}`}
                  style={isMyVote ? { borderColor: caucusColor } : undefined}
                >
                  <div className="mb-1.5 flex items-center justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-2">
                      <Link
                        href={`/character/${candidate.sequentialId ?? candidate.characterId}`}
                        className="truncate text-sm font-medium hover:text-primary"
                      >
                        {candidate.characterName}
                      </Link>
                      {candidate.isCurrentHolder && (
                        <span
                          className="shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium"
                          style={{ backgroundColor: `${caucusColor}20`, color: caucusColor }}
                        >
                          Incumbent
                        </span>
                      )}
                      {isMyVote && (
                        <span className="shrink-0 text-[10px] font-medium text-success">
                          Your Vote
                        </span>
                      )}
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <div className="text-right">
                        <div className="text-sm font-bold tabular-nums">{candidate.voteCount}</div>
                        <div className="text-[10px] text-muted">
                          {election.totalVotes > 0 ? `${pct}%` : "—"}
                        </div>
                      </div>
                      {election.status === "voting" && data.canVote && !isMyVote && (
                        <button
                          type="button"
                          onClick={() =>
                            void postAction("vote", { candidateId: candidate.characterId })
                          }
                          disabled={actionLoading}
                          className="rounded-lg border border-card-border bg-background px-2.5 py-1 text-xs hover:border-primary hover:text-primary disabled:opacity-40"
                        >
                          Vote
                        </button>
                      )}
                    </div>
                  </div>
                  {election.totalVotes > 0 && (
                    <div className="h-1 w-full overflow-hidden rounded-full bg-card-border">
                      <div
                        className="h-full rounded-full transition-all duration-500"
                        style={{ width: `${pct}%`, backgroundColor: caucusColor }}
                      />
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          <div className="mt-4 flex items-center justify-between border-t border-card-border pt-3 text-[10px] text-muted">
            <span>Total votes: {election.totalVotes}</span>
            <span>
              Turn {election.startTurn} → {election.endTurn}
            </span>
          </div>

          {!data.canVote && election.status === "voting" && (
            <p className="mt-3 rounded bg-background px-2 py-1.5 text-[10px] text-muted">
              Only active caucus members may vote or run in this election.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
