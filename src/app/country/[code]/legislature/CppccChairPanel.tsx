"use client";

import { useCallback, useEffect, useState } from "react";
import { useToast } from "@/contexts/ToastContext";
import { useGameClock } from "@/contexts/useGameClock";

interface NominationDisplay {
  _id: string;
  nomineeId: string;
  nomineeName: string;
  nomineeParty: string | null;
  votesFor: number;
  status: string;
  myVote: "for" | "against" | null;
}

interface CppccChairResponse {
  leader: { characterId: string | null; characterName: string; party: string | null } | null;
  election: {
    status: string;
    startedAt: string;
    endsAt: string;
    endsOnTurn: number | null;
  } | null;
  nominations: NominationDisplay[];
  /** True when the viewer's party is eligible under the chair_cppcc role policy. */
  canRun: boolean;
  /** Human-readable label describing the eligibility rule. */
  eligibilityLabel: string;
  viewer: {
    characterId: string | null;
    party: string | null;
    isSittingDelegate: boolean;
    isAdmin: boolean;
  };
}

const ROLE_LABEL = "Chairman of the CPPCC";

/**
 * Chairman of the CPPCC panel — mirrors the NPCSC Chair panel mechanic. The
 * advisory CPPCC body is appointed, so the electorate is the largest NPC party
 * (the CCP); buttons are gated by NPC membership + largest-single-party
 * eligibility. Mounted on the CN NPC page near the CPPCC section.
 */
export function CppccChairPanel() {
  const { showToast } = useToast();
  const clock = useGameClock();
  const [data, setData] = useState<CppccChairResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch("/api/country/cn/legislature/cppcc-chair", {
        cache: "no-store",
      });
      if (res.ok) {
        setData((await res.json()) as CppccChairResponse);
      }
    } catch {
      // silent — panel just won't populate; no toast spam on initial load
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  async function postAction(action: string, nominationId?: string) {
    setBusy(true);
    try {
      const res = await fetch("/api/country/cn/legislature/cppcc-chair", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, nominationId }),
      });
      const body = await res.json();
      if (res.ok) {
        showToast(body.message ?? "Done.", "success");
        await fetchData();
      } else {
        showToast(body.error ?? "Action failed.", "error");
      }
    } catch {
      showToast("Network error.", "error");
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return <div className="h-32 rounded-xl bg-card/60 animate-pulse" />;
  }
  // Render nothing if the response is missing or malformed (no viewer block) —
  // keeps the host page resilient to an unexpected/empty API response.
  if (!data?.viewer) return null;

  const { viewer } = data;
  const isElectionActive =
    data.election?.status === "voting" &&
    (data.election.endsOnTurn != null
      ? clock.currentTurn < data.election.endsOnTurn
      : new Date(data.election.endsAt) > clock.now);
  const canRun = data.canRun;
  const myNomination =
    viewer.characterId != null
      ? data.nominations.find((n) => n.nomineeId === viewer.characterId && n.status !== "cancelled")
      : undefined;

  return (
    <div className="rounded-xl border border-card-border/40 bg-card-muted/30 p-4 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-wider text-muted">{ROLE_LABEL}</p>
          <p className="text-base font-semibold text-foreground mt-0.5">
            {data.leader?.characterName ?? "Vacant"}
          </p>
          {data.leader?.party && (
            <p className="text-xs text-muted">{data.leader.party.toUpperCase()}</p>
          )}
        </div>
        {viewer.isAdmin && !isElectionActive && (
          <button
            onClick={() => postAction("start_election")}
            disabled={busy}
            className="rounded-lg border border-warning/40 bg-warning/10 px-3 py-1.5 text-xs font-semibold text-warning hover:bg-warning/20 disabled:opacity-40 transition-colors"
          >
            Admin · Open Election
          </button>
        )}
      </div>

      {isElectionActive && (
        <div className="space-y-2">
          <p className="text-xs text-muted">
            Election open — closes {new Date(data.election!.endsAt).toLocaleString("en-US")}.{" "}
            {data.eligibilityLabel.replace(/^./, (c) => c.toUpperCase())} may declare and vote.
          </p>

          {viewer.isSittingDelegate && canRun && !myNomination && (
            <button
              onClick={() => postAction("declare")}
              disabled={busy}
              className="rounded-lg border border-primary/40 bg-primary/10 px-3 py-1.5 text-xs font-semibold text-primary hover:bg-primary/20 disabled:opacity-40 transition-colors"
            >
              Declare for Chairman
            </button>
          )}
          {viewer.isSittingDelegate && myNomination && myNomination.status !== "cancelled" && (
            <button
              onClick={() => postAction("withdraw")}
              disabled={busy}
              className="rounded-lg border border-card-border bg-card px-3 py-1.5 text-xs text-muted hover:text-foreground disabled:opacity-40 transition-colors"
            >
              Withdraw your nomination
            </button>
          )}

          {data.nominations.length > 0 ? (
            <ul className="space-y-1.5">
              {data.nominations.map((n) => {
                const isMyVote = n.myVote === "for";
                const canVote = viewer.isSittingDelegate && canRun;
                return (
                  <li
                    key={n._id}
                    className="flex items-center justify-between gap-3 rounded-lg border border-card-border/60 bg-background/40 px-3 py-2"
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-foreground truncate">
                        {n.nomineeName}
                      </p>
                      <p className="text-[10px] text-muted">
                        {(n.nomineeParty ?? "").toUpperCase()} · {n.votesFor} votes
                      </p>
                    </div>
                    {canVote && (
                      <button
                        onClick={() => postAction("vote", n._id)}
                        disabled={busy || isMyVote}
                        className={`shrink-0 rounded-lg px-3 py-1 text-xs font-semibold transition-colors ${
                          isMyVote
                            ? "border border-success/40 bg-success/10 text-success"
                            : "border border-primary/40 bg-primary/10 text-primary hover:bg-primary/20"
                        } disabled:opacity-40`}
                      >
                        {isMyVote ? "Voted" : "Vote"}
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="text-xs text-muted/70">No nominations yet.</p>
          )}
        </div>
      )}

      {!isElectionActive && data.leader?.characterId == null && (
        <p className="text-xs text-muted/70">
          No Chairman of the CPPCC seated. An admin can open an election.
        </p>
      )}
    </div>
  );
}
