"use client";

import { useCallback, useEffect, useState } from "react";
import { useToast } from "@/contexts/ToastContext";
import { useGameClock } from "@/contexts/useGameClock";
import { LocalTime } from "@/components/time/LocalTime";
import type { CountryId } from "@/lib/constants/countries";

interface NominationDisplay {
  _id: string;
  nomineeId: string;
  nomineeName: string;
  nomineeParty: string | null;
  votesFor: number;
  status: string;
  myVote: "for" | "against" | null;
}

interface RoleState {
  role: "speaker_ng_reps" | "president_ng_senate";
  label: string;
  leader: { characterId: string | null; characterName: string; party: string | null } | null;
  election: {
    status: string;
    startedAt: string;
    endsAt: string;
    endsOnTurn: number | null;
  } | null;
  nominations: NominationDisplay[];
  canRun: boolean;
  eligibilityLabel: string;
  isMember: boolean;
}

interface NgChamberLeadershipResponse {
  roles: RoleState[];
  viewer: {
    characterId: string | null;
    party: string | null;
    isAdmin: boolean;
  };
}

/**
 * NG National Assembly presiding-officer panel. Mirrors the DE
 * Bundestagspräsident panel but renders both roles (Speaker of the House of
 * Representatives, President of the Senate). Shows the current holder, an open
 * election when active, and declare/vote/start buttons gated by chamber
 * membership and any-seated eligibility. Mounted on the NG Leadership tab.
 */
export function NgChamberLeadershipPanel({ countryId }: { countryId: CountryId }) {
  const { showToast } = useToast();
  const clock = useGameClock();
  const [data, setData] = useState<NgChamberLeadershipResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const endpoint = `/api/country/${countryId.toLowerCase()}/legislature/ng-chamber-leadership`;

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch(endpoint, { cache: "no-store" });
      if (res.ok) {
        setData((await res.json()) as NgChamberLeadershipResponse);
      }
    } catch {
      // silent — panel just won't populate; no toast spam on initial load
    } finally {
      setLoading(false);
    }
  }, [endpoint]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  async function postAction(role: string, action: string, nominationId?: string) {
    setBusy(true);
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role, action, nominationId }),
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

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {data.roles.map((r) => {
        const isElectionActive =
          r.election?.status === "voting" &&
          (r.election.endsOnTurn != null
            ? clock.currentTurn < r.election.endsOnTurn
            : new Date(r.election.endsAt) > clock.now);
        const myNomination =
          viewer.characterId != null
            ? r.nominations.find(
                (n) => n.nomineeId === viewer.characterId && n.status !== "cancelled"
              )
            : undefined;
        const canDeclare = r.isMember && r.canRun;

        return (
          <div
            key={r.role}
            className="rounded-xl border border-card-border/40 bg-card-muted/30 p-4 space-y-3"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs uppercase tracking-wider text-muted">{r.label}</p>
                <p className="text-base font-semibold text-foreground mt-0.5">
                  {r.leader?.characterName ?? "Vacant"}
                </p>
                {r.leader?.party && (
                  <p className="text-xs text-muted">{r.leader.party.toUpperCase()}</p>
                )}
              </div>
              {viewer.isAdmin && !isElectionActive && (
                <button
                  onClick={() => postAction(r.role, "start_election")}
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
                  Election open — closes <LocalTime value={r.election!.endsAt} />.{" "}
                  {r.eligibilityLabel.replace(/^./, (c) => c.toUpperCase())} may declare and vote.
                </p>

                {canDeclare && !myNomination && (
                  <button
                    onClick={() => postAction(r.role, "declare")}
                    disabled={busy}
                    className="rounded-lg border border-primary/40 bg-primary/10 px-3 py-1.5 text-xs font-semibold text-primary hover:bg-primary/20 disabled:opacity-40 transition-colors"
                  >
                    Declare for this office
                  </button>
                )}
                {r.isMember && myNomination && myNomination.status !== "cancelled" && (
                  <button
                    onClick={() => postAction(r.role, "withdraw")}
                    disabled={busy}
                    className="rounded-lg border border-card-border bg-card px-3 py-1.5 text-xs text-muted hover:text-foreground disabled:opacity-40 transition-colors"
                  >
                    Withdraw your nomination
                  </button>
                )}

                {r.nominations.length > 0 ? (
                  <ul className="space-y-1.5">
                    {r.nominations.map((n) => {
                      const isMyVote = n.myVote === "for";
                      const canVote = r.isMember && r.canRun;
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
                              onClick={() => postAction(r.role, "vote", n._id)}
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

            {!isElectionActive && r.leader?.characterId == null && (
              <p className="text-xs text-muted/70">
                No presiding officer seated. An admin can open an election.
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}
