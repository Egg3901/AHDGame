"use client";

import { useCallback, useEffect, useState } from "react";
import { useToast } from "@/contexts/ToastContext";
import { useGameClock } from "@/contexts/useGameClock";
import { LocalTime } from "@/components/time/LocalTime";

interface NominationDisplay {
  _id: string;
  nomineeId: string;
  nomineeName: string;
  nomineeParty: string | null;
  votesFor: number;
  status: string;
  myVote: "for" | "against" | null;
}

interface BundestagspraesidentResponse {
  leader: { characterId: string | null; characterName: string; party: string | null } | null;
  election: {
    status: string;
    startedAt: string;
    endsAt: string;
    endsOnTurn: number | null;
  } | null;
  nominations: NominationDisplay[];
  /** True when the viewer's party is eligible under the Bundestagspräsident role policy. */
  canRunForBundestagspraesident: boolean;
  /** Human-readable label describing the eligibility rule. */
  eligibilityLabel: string;
  /** Viewer identity, resolved server-side from session. Null fields when
   *  the viewer isn't logged in or doesn't have a character. */
  viewer: {
    characterId: string | null;
    party: string | null;
    isSittingMdB: boolean;
    isAdmin: boolean;
  };
}

/**
 * Bundestagspräsident panel — mirrors the US House Speaker panel mechanic.
 * Shows the current presiding officer, an open election when active, and
 * declare/vote/start buttons gated by Bundestag membership + majority-bloc
 * eligibility. Viewer identity comes from the GET response (server-side
 * session lookup) so the panel can self-source without a separate
 * /api/auth/me round-trip. Mounted on the DE Bundestag page Leadership tab.
 */
export function BundestagspraesidentPanel() {
  const { showToast } = useToast();
  const clock = useGameClock();
  const [data, setData] = useState<BundestagspraesidentResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch("/api/country/de/legislature/bundestagspraesident", {
        cache: "no-store",
      });
      if (res.ok) {
        setData((await res.json()) as BundestagspraesidentResponse);
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
      const res = await fetch("/api/country/de/legislature/bundestagspraesident", {
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
  if (!data) return null;

  const { viewer } = data;
  // Turn-based: open while currentTurn < endsOnTurn (freezes on pause). Falls
  // back to the game-clock endsAt for any pre-backfill election.
  const isElectionActive =
    data.election?.status === "voting" &&
    (data.election.endsOnTurn != null
      ? clock.currentTurn < data.election.endsOnTurn
      : new Date(data.election.endsAt) > clock.now);
  const canRun = data.canRunForBundestagspraesident;
  const myNomination =
    viewer.characterId != null
      ? data.nominations.find((n) => n.nomineeId === viewer.characterId && n.status !== "cancelled")
      : undefined;

  return (
    <div className="rounded-xl border border-card-border/40 bg-card-muted/30 p-4 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-wider text-muted">Bundestagspräsident</p>
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
            Election open — closes <LocalTime value={data.election!.endsAt} />.{" "}
            {data.eligibilityLabel.replace(/^./, (c) => c.toUpperCase())} may declare and vote.
          </p>

          {viewer.isSittingMdB && canRun && !myNomination && (
            <button
              onClick={() => postAction("declare")}
              disabled={busy}
              className="rounded-lg border border-primary/40 bg-primary/10 px-3 py-1.5 text-xs font-semibold text-primary hover:bg-primary/20 disabled:opacity-40 transition-colors"
            >
              Declare for Bundestagspräsident
            </button>
          )}
          {viewer.isSittingMdB && myNomination && myNomination.status !== "cancelled" && (
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
                const canVote = viewer.isSittingMdB && canRun;
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
          No Bundestagspräsident seated. An admin can open an election.
        </p>
      )}
    </div>
  );
}
