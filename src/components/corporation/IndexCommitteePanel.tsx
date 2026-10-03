"use client";

import { useCallback, useState } from "react";
import { useAbortableEffectFetch } from "@/hooks/useAbortableEffectFetch";
import { DenseSection, InlineStatus, SmallButton, Td } from "./dense/DenseKit";

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
    <DenseSection title="Index committee">
      <div className="space-y-2 py-1 text-xs">
        <p className="text-muted">
          A corporation that misses a listing standard can ask to be admitted to the indices anyway.
          Solvency is never waivable.
        </p>

        {showIssuer && committee && (
          <div className="space-y-2">
            <p className="text-muted">
              Decided by <span className="font-medium text-foreground">{committee.seatName}</span>
              {committee.vacant
                ? " (vacant, the deadline decides)"
                : committee.holderIsNpp
                  ? ` (${committee.holderName}, the deadline decides)`
                  : ` (${committee.holderName})`}
            </p>

            {standing?.waiver && (
              <p className="font-medium text-success">
                Waiver in force through turn {standing.waiver.waiverUntilTurn ?? "?"}.
              </p>
            )}

            {standing?.pending && (
              <p className="text-foreground">
                Petition before the {standing.pending.seatName}, filed turn{" "}
                {standing.pending.filedAtTurn}, decided by turn {standing.pending.deadlineAtTurn}.
                Contribution {formatAnchor(standing.pending.contributionAnchor)}.
              </p>
            )}

            {standing?.isCeo && !standing.pending && !standing.waiver && (
              <div className="space-y-1.5">
                <p className="text-muted">
                  Lobbying contribution, paid from corporate cash on filing and never refunded. An
                  unattended petition needs at least{" "}
                  {formatAnchor(standing.suggestedContributionAnchor)} to carry; one too far below
                  the bar is refused at any price.
                </p>
                <div className="flex items-center gap-1.5">
                  <input
                    type="number"
                    min={1}
                    value={contribution}
                    onChange={(e) => setContribution(e.target.value)}
                    aria-label="Lobbying contribution"
                    className="h-7 w-40 rounded-md border border-card-border bg-background px-2 text-right font-mono text-[13px] text-foreground focus:border-foreground focus:outline-none"
                  />
                  <SmallButton tone="primary" disabled={loading || !contribution} onClick={file}>
                    Petition
                  </SmallButton>
                </div>
              </div>
            )}
          </div>
        )}

        {showInbox && (
          <div className="space-y-1">
            <p className="font-medium text-foreground">Before you as {seatName}</p>
            <table className="w-full border-collapse">
              <tbody>
                {inbox.map((petition) => (
                  <tr key={petition.id}>
                    <Td>
                      <span className="text-foreground">{petition.corporationName}</span>
                      <span className="ml-2 text-xs text-muted">
                        filed turn {petition.filedAtTurn}, decide by {petition.deadlineAtTurn},
                        contribution {formatAnchor(petition.contributionAnchor)}
                      </span>
                    </Td>
                    <Td align="right" numeric={false}>
                      <span className="inline-flex gap-1.5">
                        <SmallButton disabled={loading} onClick={() => decide(petition.id, true)}>
                          Grant
                        </SmallButton>
                        <SmallButton disabled={loading} onClick={() => decide(petition.id, false)}>
                          Refuse
                        </SmallButton>
                      </span>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <InlineStatus message={error} tone="error" />
      </div>
    </DenseSection>
  );
}
