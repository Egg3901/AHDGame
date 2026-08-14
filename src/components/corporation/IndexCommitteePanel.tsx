"use client";

import { useCallback, useState } from "react";
import { useAbortableEffectFetch } from "@/hooks/useAbortableEffectFetch";

/**
 * A7 part 2 surface, mirroring `MergerReviewPanel`: one panel serving both
 * roles off two endpoints. The issuer half shows this corporation's standing
 * with the committee and lets its CEO file. The committee half appears only for
 * whoever holds the seat, and is hidden entirely for everyone else rather than
 * showing them an empty inbox.
 */

interface Committee {
  seatId: string;
  seatName: string;
  holderName: string | null;
  holderIsNpp: boolean;
  vacant: boolean;
}

interface IssuerStanding {
  committee: Committee | null;
  isCeo: boolean;
  suggestedContributionAnchor: number;
  pending: {
    id: string;
    filedAtTurn: number;
    deadlineAtTurn: number;
    contributionAnchor: number;
    seatName: string;
  } | null;
  waiver: { id: string; waiverUntilTurn: number | null } | null;
}

interface InboxPetition {
  id: string;
  corporationId: string;
  corporationName: string;
  filedAtTurn: number;
  deadlineAtTurn: number;
  contributionAnchor: number;
}

function formatAnchor(value: number): string {
  return `₳${Math.round(value).toLocaleString("en-US")}`;
}

export default function IndexCommitteePanel({ corpId }: { corpId: string }) {
  const [standing, setStanding] = useState<IssuerStanding | null>(null);
  const [inbox, setInbox] = useState<InboxPetition[]>([]);
  const [seatName, setSeatName] = useState<string | null>(null);
  const [contribution, setContribution] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(
    async (signal?: AbortSignal) => {
      try {
        const [standingRes, inboxRes] = await Promise.all([
          fetch(`/api/corporations/${corpId}/index-petition`, { signal }),
          fetch(`/api/index-petitions`, { signal }),
        ]);
        if (standingRes.ok) {
          const data: IssuerStanding = await standingRes.json();
          setStanding(data);
          if (!contribution) {
            setContribution(String(Math.round(data.suggestedContributionAnchor)));
          }
        }
        if (inboxRes.ok) {
          const data = await inboxRes.json();
          setInbox(data.petitions ?? []);
          setSeatName(data.seat?.seatName ?? null);
        }
      } catch {
        // the panel is supplementary; the rest of the tab still works
      }
      // `contribution` is deliberately not a dependency: refilling it on every
      // reload would overwrite what the player is in the middle of typing.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    },
    [corpId]
  );

  // Aborts on unmount: without it the response lands on a component nobody is
  // looking at, and in tests it rejects during happy-dom teardown.
  const reload = useAbortableEffectFetch((signal) => load(signal), [load]);

  async function file() {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`/api/corporations/${corpId}/index-petition`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contributionAnchor: Number(contribution) }),
      });
      if (!res.ok) throw new Error((await res.json()).error);
      reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setLoading(false);
    }
  }

  async function decide(petitionId: string, grant: boolean) {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`/api/index-petitions/${petitionId}/decide`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ grant }),
      });
      if (!res.ok) throw new Error((await res.json()).error);
      reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setLoading(false);
    }
  }

  const committee = standing?.committee ?? null;
  const showIssuer = committee !== null;
  const showInbox = seatName !== null && inbox.length > 0;
  if (!showIssuer && !showInbox) return null;

  return (
    <div className="rounded-xl border bg-card p-5 space-y-4 shadow-sm">
      <div>
        <h3 className="font-semibold text-sm">Index committee</h3>
        <p className="text-xs text-muted-foreground">
          A corporation that misses a listing standard can ask to be admitted to the indices anyway.
          Solvency is never waivable.
        </p>
      </div>

      {showIssuer && committee && (
        <div className="space-y-2 text-xs">
          <p>
            <span className="text-muted-foreground">Decided by</span>{" "}
            <span className="font-medium">{committee.seatName}</span>
            {committee.vacant ? (
              <span className="text-muted-foreground"> (vacant, the deadline decides)</span>
            ) : committee.holderIsNpp ? (
              <span className="text-muted-foreground">
                {" "}
                ({committee.holderName}, the deadline decides)
              </span>
            ) : (
              <span className="text-muted-foreground"> ({committee.holderName})</span>
            )}
          </p>

          {standing?.waiver && (
            <p className="rounded-lg bg-green-100 px-3 py-2 font-medium text-green-800 dark:bg-green-900/30 dark:text-green-300">
              Waiver in force through turn {standing.waiver.waiverUntilTurn ?? "?"}.
            </p>
          )}

          {standing?.pending && (
            <p className="rounded-lg bg-muted px-3 py-2">
              Petition before the {standing.pending.seatName}, filed turn{" "}
              {standing.pending.filedAtTurn}, decided by turn {standing.pending.deadlineAtTurn}.
              Contribution {formatAnchor(standing.pending.contributionAnchor)}.
            </p>
          )}

          {standing?.isCeo && !standing.pending && !standing.waiver && (
            <div className="space-y-2">
              <label className="block text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Lobbying contribution
              </label>
              <p className="text-muted-foreground">
                Paid from corporate cash on filing and never refunded. An unattended petition needs
                at least {formatAnchor(standing.suggestedContributionAnchor)} to carry, and a
                shortfall too far below the bar is refused at any price.
              </p>
              <div className="flex gap-2">
                <input
                  type="number"
                  min={1}
                  value={contribution}
                  onChange={(e) => setContribution(e.target.value)}
                  className="w-40 rounded-lg border border-card-border bg-card px-2 py-1"
                />
                <button
                  type="button"
                  disabled={loading || !contribution}
                  onClick={file}
                  className="rounded-lg bg-primary px-3 py-1 font-semibold text-primary-foreground disabled:opacity-50"
                >
                  Petition
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {showInbox && (
        <div className="space-y-2 border-t border-card-border pt-3">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Before you as {seatName}
          </p>
          {inbox.map((petition) => (
            <div
              key={petition.id}
              className="flex flex-wrap items-center justify-between gap-2 text-xs"
            >
              <div>
                <p className="font-medium">{petition.corporationName}</p>
                <p className="text-muted-foreground">
                  Filed turn {petition.filedAtTurn}, decide by {petition.deadlineAtTurn},
                  contribution {formatAnchor(petition.contributionAnchor)}
                </p>
              </div>
              <div className="flex gap-1.5">
                <button
                  type="button"
                  disabled={loading}
                  onClick={() => decide(petition.id, true)}
                  className="rounded-lg bg-green-100 px-2.5 py-1 font-semibold text-green-800 dark:bg-green-900/30 dark:text-green-300"
                >
                  Grant
                </button>
                <button
                  type="button"
                  disabled={loading}
                  onClick={() => decide(petition.id, false)}
                  className="rounded-lg bg-red-100 px-2.5 py-1 font-semibold text-red-800 dark:bg-red-900/30 dark:text-red-300"
                >
                  Refuse
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {error && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-xs font-medium text-red-600 dark:bg-red-950/30">
          {error}
        </p>
      )}
    </div>
  );
}
