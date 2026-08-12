"use client";

import { useCallback, useEffect, useState } from "react";
import type { CountryId } from "@/lib/constants/countries";
import { PlayerSelector } from "@/components/PlayerSelector";

interface BoardSeat {
  seatId: string;
  isChair: boolean;
  occupantType: "player" | "npp" | "vacant";
  name: string;
  alignment: "hawk" | "dove";
  termExpiresAtTurn: number | null;
}

interface MeetingState {
  motion: "hike" | "cut" | "hold";
  proposedDelta: number;
  playerVoteDeadline: string;
  resolvesOnTurn: number;
  agree: number;
  disagree: number;
  needed: number;
  viewerHasVoted: boolean;
  viewerCanVote: boolean;
}

interface CommitteeState {
  hasCommittee: boolean;
  primeRate: number;
  rateChangesThisTerm: number;
  rateChangesPerTerm: number;
  canNominate: boolean;
  viewerSeatId: string | null;
  board: BoardSeat[];
  meeting: MeetingState | null;
}

const MOTION_LABEL: Record<string, string> = { hike: "Raise rate", cut: "Cut rate", hold: "Hold" };

function AlignmentChip({ alignment }: { alignment: "hawk" | "dove" }) {
  const hawk = alignment === "hawk";
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
        hawk ? "bg-danger/10 text-danger" : "bg-primary/10 text-primary"
      }`}
    >
      {hawk ? "Hawk" : "Dove"}
    </span>
  );
}

export function FomcCommitteeTab({ countryId }: { countryId: CountryId }) {
  const code = countryId.toLowerCase();
  const [state, setState] = useState<CommitteeState | null>(null);
  const [loading, setLoading] = useState(true);
  const [voting, setVoting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nomSeatId, setNomSeatId] = useState<string>("");
  const [nomAlignment, setNomAlignment] = useState<"hawk" | "dove">("hawk");
  const [nomMakeChair, setNomMakeChair] = useState(false);
  const [nomStatus, setNomStatus] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/country/${code}/fomc`, { cache: "no-store" });
      if (!res.ok) throw new Error("Failed to load committee");
      setState(await res.json());
    } catch {
      setError("Could not load the committee.");
    } finally {
      setLoading(false);
    }
  }, [code]);

  useEffect(() => {
    void load();
  }, [load]);

  const castVote = useCallback(
    async (vote: "hike" | "cut" | "hold") => {
      setVoting(true);
      setError(null);
      try {
        const res = await fetch(`/api/country/${code}/fomc/vote`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ vote }),
        });
        if (!res.ok) {
          const body = (await res.json().catch(() => null)) as { error?: string } | null;
          throw new Error(body?.error ?? "Vote failed");
        }
        await load();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Vote failed");
      } finally {
        setVoting(false);
      }
    },
    [code, load]
  );

  const nominate = useCallback(
    async (characterId: string) => {
      const seatId = nomSeatId || state?.board[0]?.seatId;
      if (!seatId) return;
      setNomStatus(null);
      setError(null);
      try {
        const res = await fetch(`/api/country/${code}/fomc/nominate`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            seatId,
            alignment: nomAlignment,
            makeChair: nomMakeChair,
            nomineeCharacterId: characterId,
          }),
        });
        if (!res.ok) {
          const body = (await res.json().catch(() => null)) as { error?: string } | null;
          throw new Error(body?.error ?? "Nomination failed");
        }
        setNomStatus("Nomination sent to the Senate for confirmation.");
        await load();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Nomination failed");
      }
    },
    [code, nomSeatId, nomAlignment, nomMakeChair, state, load]
  );

  if (loading) return <p className="py-8 text-center text-sm text-muted">Loading committee…</p>;
  if (!state?.hasCommittee)
    return (
      <p className="py-8 text-center text-sm text-muted">
        This central bank does not have an FOMC committee.
      </p>
    );

  const { board, meeting } = state;
  const budgetLeft = state.rateChangesPerTerm - state.rateChangesThisTerm;

  return (
    <div className="space-y-6">
      {/* Per-term budget + active meeting */}
      <div className="rounded-xl border border-card-border bg-card shadow-sm">
        <div className="border-b border-card-border px-5 py-4">
          <h2 className="text-sm font-semibold text-foreground">Federal Open Market Committee</h2>
          <p className="mt-0.5 text-xs text-muted">
            The committee votes on rate moves. A motion passes only on a majority of the full board;
            no-shows abstain. {budgetLeft} of {state.rateChangesPerTerm} rate changes remain this
            term.
          </p>
        </div>

        {meeting ? (
          <div className="px-5 py-4">
            <div className="flex items-center gap-3">
              <span className="text-sm font-semibold text-foreground">
                Motion: {MOTION_LABEL[meeting.motion]}
                {meeting.motion !== "hold" &&
                  ` (${meeting.proposedDelta > 0 ? "+" : ""}${meeting.proposedDelta.toFixed(2)}pp)`}
              </span>
              <span className="ml-auto text-xs text-muted">
                {meeting.agree} for / {meeting.disagree} against · {meeting.needed} needed
              </span>
            </div>

            {state.viewerSeatId && (
              <div className="mt-4">
                {meeting.viewerHasVoted ? (
                  <p className="text-xs text-muted">Your ballot is recorded.</p>
                ) : (
                  <div className="flex gap-2">
                    {(["hike", "cut", "hold"] as const).map((v) => (
                      <button
                        key={v}
                        disabled={voting || !meeting.viewerCanVote}
                        onClick={() => castVote(v)}
                        className="rounded-lg border border-card-border px-3 py-1.5 text-xs font-semibold text-foreground transition-colors hover:bg-card-elevated/60 disabled:opacity-50"
                      >
                        {MOTION_LABEL[v]}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        ) : (
          <p className="px-5 py-4 text-sm text-muted">No meeting is currently in session.</p>
        )}
      </div>

      {error && <p className="text-xs text-danger">{error}</p>}

      {/* Nominate (executive only) */}
      {state.canNominate && (
        <div className="rounded-xl border border-card-border bg-card shadow-sm">
          <div className="border-b border-card-border px-5 py-4">
            <h3 className="text-sm font-semibold text-foreground">Nominate a governor</h3>
            <p className="mt-0.5 text-xs text-muted">
              Choose a seat and temperament, then pick a player. The nominee goes to the Senate for
              confirmation before taking the seat.
            </p>
          </div>
          <div className="space-y-3 px-5 py-4">
            <div className="flex flex-wrap items-center gap-3">
              <label className="text-xs font-medium text-muted">
                Seat{" "}
                <select
                  value={nomSeatId || board[0]?.seatId}
                  onChange={(e) => setNomSeatId(e.target.value)}
                  className="ml-1 rounded-md border border-card-border bg-card px-2 py-1 text-xs text-foreground"
                >
                  {board.map((s) => (
                    <option key={s.seatId} value={s.seatId}>
                      {s.isChair ? "Chair - " : ""}
                      {s.name} ({s.alignment})
                    </option>
                  ))}
                </select>
              </label>

              <div className="flex gap-1">
                {(["hawk", "dove"] as const).map((a) => (
                  <button
                    key={a}
                    type="button"
                    onClick={() => setNomAlignment(a)}
                    className={`rounded-md px-2.5 py-1 text-xs font-semibold ${
                      nomAlignment === a
                        ? "bg-primary/10 text-primary"
                        : "border border-card-border text-muted"
                    }`}
                  >
                    {a === "hawk" ? "Hawk" : "Dove"}
                  </button>
                ))}
              </div>

              <label className="flex items-center gap-1.5 text-xs font-medium text-muted">
                <input
                  type="checkbox"
                  checked={nomMakeChair}
                  onChange={(e) => setNomMakeChair(e.target.checked)}
                />
                Appoint as Chair
              </label>
            </div>

            <PlayerSelector
              onSelect={(c) => void nominate(c.id)}
              countryId={countryId}
              placeholder="Search for a player to nominate…"
            />

            {nomStatus && <p className="text-xs text-primary">{nomStatus}</p>}
          </div>
        </div>
      )}

      {/* Board roster */}
      <div className="rounded-xl border border-card-border bg-card shadow-sm overflow-hidden">
        <div className="border-b border-card-border px-5 py-4">
          <h3 className="text-sm font-semibold text-foreground">Board of Governors</h3>
        </div>
        <ul className="divide-y divide-card-border">
          {board.map((seat) => (
            <li key={seat.seatId} className="flex items-center gap-3 px-5 py-3">
              <span className="text-sm font-medium text-foreground">{seat.name}</span>
              {seat.isChair && (
                <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-bold text-primary">
                  Chair
                </span>
              )}
              {seat.occupantType === "player" && (
                <span className="rounded-full bg-card-elevated px-2 py-0.5 text-[10px] font-bold text-muted">
                  Player
                </span>
              )}
              <span className="ml-auto flex items-center gap-2">
                {seat.occupantType === "vacant" ? (
                  <span className="text-[10px] font-bold text-muted">Vacant</span>
                ) : (
                  <AlignmentChip alignment={seat.alignment} />
                )}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
