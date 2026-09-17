"use client";

import { useCallback, useEffect, useState } from "react";
import { getMessageStyle } from "@/lib/utils/formatters";

interface ConferenceProposalView {
  pledgeIds: string[];
  proposedByName: string;
  proposedAtTurn: number;
  votesFor: number;
  votesAgainst: number;
  status: "voting" | "ratified" | "rejected";
  resolvedAtTurn: number | null;
  quorumNeeded: number;
  eligibleVoters: number;
}

interface ConferenceMotionView {
  motionId: string;
  patch: Record<string, string | number>;
  proposedByName: string;
  createdAtTurn: number;
  votesFor: number;
  votesAgainst: number;
  status: "voting" | "passed" | "failed" | "void";
  voidReason: string | null;
  resolvedAtTurn: number | null;
  quorumNeeded: number;
  eligibleVoters: number;
}

interface ConferenceState {
  conferenceId: string;
  year: number;
  status: "scheduled" | "open" | "completed" | "expired";
  partyName: string;
  isNpp: boolean;
  opensAtTurn: number;
  votingClosesTurn: number;
  turnsUntilOpen: number;
  turnsUntilClose: number;
  proposal: ConferenceProposalView | null;
  motions: ConferenceMotionView[];
  platform: { pledgeIds: string[]; ratifiedYear: number; ratifiedAtTurn: number } | null;
  ratified: boolean;
  outcome: "ratified" | "closedWithoutRatification" | "missed" | null;
  payoff: { due: boolean; appliedTurn: number | null };
  catalog: { id: string; label: string; blurb: string }[];
  capabilities: {
    isPartyMember: boolean;
    isCommitteeMember: boolean;
    isLeader: boolean;
    canPropose: boolean;
    canVote: boolean;
  };
  history: { turn: number; at: string; kind: string; actorName?: string; detail: string }[];
}

const STATUS_LABEL: Record<ConferenceState["status"], string> = {
  scheduled: "Scheduled",
  open: "Open",
  completed: "Completed",
  expired: "Expired",
};

export function ConferencePanel({
  countryCode,
  partyId,
}: {
  countryCode: string;
  partyId: string;
}) {
  const [data, setData] = useState<ConferenceState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [acting, setActing] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [selected, setSelected] = useState<string[]>([]);

  const baseUrl = `/api/country/${countryCode.toLowerCase()}/parties/${partyId}/conference`;

  const fetchState = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(baseUrl, { credentials: "same-origin" });
      if (!res.ok) {
        const payload = await res.json().catch(() => null);
        setError(payload?.error ?? "Failed to load conference state");
        return;
      }
      const state = (await res.json()) as ConferenceState;
      setData(state);
      if (state.proposal) setSelected(state.proposal.pledgeIds);
      else setSelected([]);
    } catch {
      setError("Network error loading conference state");
    } finally {
      setLoading(false);
    }
  }, [baseUrl]);

  useEffect(() => {
    void fetchState();
  }, [fetchState]);

  const runAction = useCallback(
    async (key: string, url: string, init: RequestInit, okDetail?: string) => {
      setActing(key);
      setMessage("");
      try {
        const res = await fetch(url, { ...init, credentials: "same-origin" });
        const payload = await res.json().catch(() => null);
        if (!res.ok) {
          setMessage(`Error: ${payload?.error ?? "Action failed"}`);
          return;
        }
        if (okDetail) setMessage(okDetail);
        await fetchState();
      } catch {
        setMessage("Error: network error");
      } finally {
        setActing(null);
      }
    },
    [fetchState]
  );

  const togglePledge = useCallback((id: string) => {
    setSelected((prev) => (prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id]));
  }, []);

  if (loading && !data) {
    return (
      <div className="space-y-3" aria-busy="true" aria-label="Loading conference">
        <div className="h-5 w-48 animate-pulse rounded bg-card-border" />
        <div className="h-4 w-full animate-pulse rounded bg-card-border" />
        <div className="h-4 w-3/4 animate-pulse rounded bg-card-border" />
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="rounded-md border border-error/40 bg-error/10 px-4 py-3 text-sm">
        <p>{error}</p>
        <button
          type="button"
          onClick={() => void fetchState()}
          className="mt-2 rounded-md border border-card-border px-3 py-1.5 text-body-sm font-semibold hover:bg-background"
        >
          Retry
        </button>
      </div>
    );
  }

  if (!data) return null;
  const busy = acting !== null;
  const labelById = new Map(data.catalog.map((e) => [e.id, e.label]));

  return (
    <div className="space-y-6">
      <div aria-live="polite" className={getMessageStyle(message)} role="status">
        {message}
      </div>

      <section aria-label="Party conference" className="rounded-lg border border-card-border p-4">
        <h3 className="text-heading-sm font-bold">
          {data.partyName} conference {data.year}: {STATUS_LABEL[data.status]}
        </h3>
        {data.isNpp ? (
          <p className="mt-1 text-body-sm text-muted">
            This party is AI-run: its committee tables and acclaims the standing platform
            automatically. Player actions are disabled.
          </p>
        ) : data.status === "scheduled" ? (
          <p className="mt-1 text-body-sm text-muted">
            Opens in {data.turnsUntilOpen} turn(s) (turn {data.opensAtTurn}); voting closes turn{" "}
            {data.votingClosesTurn}.
          </p>
        ) : data.status === "open" ? (
          <p className="mt-1 text-body-sm text-muted">
            Open now. Voting closes in {data.turnsUntilClose} turn(s) (turn {data.votingClosesTurn}
            ). Ratified platforms lock the standing platform between elections; the leader finalises
            the election manifesto from it at dissolution.
          </p>
        ) : data.status === "completed" ? (
          <p className="mt-1 text-body-sm text-muted">
            {data.outcome === "ratified"
              ? `Completed: the platform was ratified${data.payoff.appliedTurn != null ? " and the payoff applied" : ""}.`
              : "Completed without ratifying a platform: no payoff."}
          </p>
        ) : (
          <p className="mt-1 text-body-sm text-muted">
            This conference missed its window and expired with no platform.
          </p>
        )}
        {!data.capabilities.isPartyMember && (
          <p className="mt-2 text-body-sm text-warning">
            You are not a member of this party: conference actions are disabled.
          </p>
        )}
      </section>

      {data.platform && (
        <section
          aria-label="Standing platform"
          className="rounded-lg border border-card-border p-4"
        >
          <h3 className="text-heading-sm font-bold">Standing platform</h3>
          <p className="mt-1 text-body-sm text-muted">
            Ratified at the {data.platform.ratifiedYear} conference (turn{" "}
            {data.platform.ratifiedAtTurn}).
          </p>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-body-sm">
            {data.platform.pledgeIds.map((id) => (
              <li key={id}>{labelById.get(id) ?? id}</li>
            ))}
          </ul>
        </section>
      )}

      <section aria-label="Platform proposal" className="rounded-lg border border-card-border p-4">
        <h3 className="text-heading-sm font-bold">Platform proposal</h3>
        {data.proposal ? (
          <div className="mt-2 text-body-sm">
            <p className="text-muted">
              Proposed by {data.proposal.proposedByName} (turn {data.proposal.proposedAtTurn}):{" "}
              {data.proposal.status}. {data.proposal.votesFor} ratify, {data.proposal.votesAgainst}{" "}
              reject (quorum {data.proposal.quorumNeeded} of {data.proposal.eligibleVoters}{" "}
              members).
            </p>
            <ul className="mt-2 list-disc space-y-1 pl-5">
              {data.proposal.pledgeIds.map((id) => (
                <li key={id}>{labelById.get(id) ?? id}</li>
              ))}
            </ul>
            {data.status === "open" && data.proposal.status === "voting" && (
              <div className="mt-3 flex gap-2">
                <button
                  type="button"
                  disabled={busy || !data.capabilities.canVote}
                  title={data.capabilities.canVote ? undefined : "Party members only"}
                  onClick={() =>
                    void runAction(
                      "vote-aye",
                      `${baseUrl}/platform/vote`,
                      {
                        method: "POST",
                        headers: { "content-type": "application/json" },
                        body: JSON.stringify({ vote: "aye" }),
                      },
                      "Ratify vote recorded."
                    )
                  }
                  className="rounded-md border border-primary/40 bg-primary/10 px-3 py-1.5 text-body-sm font-semibold text-primary disabled:opacity-50"
                >
                  Ratify
                </button>
                <button
                  type="button"
                  disabled={busy || !data.capabilities.canVote}
                  title={data.capabilities.canVote ? undefined : "Party members only"}
                  onClick={() =>
                    void runAction(
                      "vote-nay",
                      `${baseUrl}/platform/vote`,
                      {
                        method: "POST",
                        headers: { "content-type": "application/json" },
                        body: JSON.stringify({ vote: "nay" }),
                      },
                      "Reject vote recorded."
                    )
                  }
                  className="rounded-md border border-card-border px-3 py-1.5 text-body-sm font-semibold hover:bg-background disabled:opacity-50"
                >
                  Reject
                </button>
              </div>
            )}
          </div>
        ) : (
          <p className="mt-2 text-body-sm text-muted">
            {data.status === "open"
              ? "No platform proposed yet."
              : "No platform was proposed at this conference."}
          </p>
        )}
        {data.status === "open" && !data.isNpp && (
          <div className="mt-4 border-t border-card-border pt-4">
            <h4 className="text-body-sm font-bold">
              {data.proposal ? "Replace the proposal" : "Propose a platform"} (leader or committee)
            </h4>
            <div className="mt-2 space-y-1.5">
              {data.catalog.map((entry) => (
                <label key={entry.id} className="flex items-start gap-2 text-body-sm">
                  <input
                    type="checkbox"
                    checked={selected.includes(entry.id)}
                    onChange={() => togglePledge(entry.id)}
                    disabled={busy || !data.capabilities.canPropose}
                    className="mt-1"
                  />
                  <span>
                    <span className="font-semibold">{entry.label}</span>
                    <span className="text-muted"> ({entry.id})</span>
                  </span>
                </label>
              ))}
            </div>
            <p className="mt-1 text-body-xs text-muted">
              Selected {selected.length}. The platform needs exactly the manifesto pledge count with
              no duplicates; replacing resets the vote.
            </p>
            <button
              type="button"
              disabled={busy || !data.capabilities.canPropose}
              title={data.capabilities.canPropose ? undefined : "Leader or committee only"}
              onClick={() =>
                void runAction(
                  "propose",
                  `${baseUrl}/platform`,
                  {
                    method: "POST",
                    headers: { "content-type": "application/json" },
                    body: JSON.stringify({ pledgeIds: selected }),
                  },
                  "Platform proposed."
                )
              }
              className="mt-2 rounded-md border border-primary/40 bg-primary/10 px-3 py-1.5 text-body-sm font-semibold text-primary disabled:opacity-50"
            >
              Propose platform
            </button>
          </div>
        )}
      </section>

      <section aria-label="Committee motions" className="rounded-lg border border-card-border p-4">
        <h3 className="text-heading-sm font-bold">Committee motions</h3>
        <p className="mt-1 text-body-sm text-muted">
          Leadership-ruleset amendments under committee authority. A motion that passes its vote
          still voids when the amendment cooldown fired since it was proposed.
        </p>
        {data.motions.length === 0 ? (
          <p className="mt-2 text-body-sm text-muted">No motions at this conference.</p>
        ) : (
          <ul className="mt-2 space-y-3">
            {data.motions.map((motion) => (
              <li
                key={motion.motionId}
                className="rounded-md border border-card-border p-3 text-body-sm"
              >
                <p>
                  <span className="font-semibold">{motion.status}</span> by {motion.proposedByName}{" "}
                  (turn {motion.createdAtTurn}):{" "}
                  {Object.entries(motion.patch)
                    .map(([k, v]) => `${k} = ${String(v)}`)
                    .join("; ")}
                </p>
                <p className="text-muted">
                  {motion.votesFor} for, {motion.votesAgainst} against (quorum {motion.quorumNeeded}{" "}
                  of {motion.eligibleVoters} committee).
                  {motion.voidReason ? ` ${motion.voidReason}.` : ""}
                </p>
                {data.status === "open" && motion.status === "voting" && (
                  <div className="mt-2 flex gap-2">
                    {(["aye", "nay"] as const).map((vote) => (
                      <button
                        key={vote}
                        type="button"
                        disabled={busy || !data.capabilities.isCommitteeMember}
                        title={data.capabilities.isCommitteeMember ? undefined : "Committee only"}
                        onClick={() =>
                          void runAction(
                            `motion-${motion.motionId}-${vote}`,
                            `${baseUrl}/motions/vote`,
                            {
                              method: "POST",
                              headers: { "content-type": "application/json" },
                              body: JSON.stringify({ motionId: motion.motionId, vote }),
                            },
                            "Motion vote recorded."
                          )
                        }
                        className="rounded-md border border-card-border px-3 py-1.5 text-body-sm font-semibold hover:bg-background disabled:opacity-50"
                      >
                        {vote === "aye" ? "For" : "Against"}
                      </button>
                    ))}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-label="Conference history" className="rounded-lg border border-card-border p-4">
        <h3 className="text-heading-sm font-bold">History</h3>
        {data.history.length === 0 ? (
          <p className="mt-2 text-body-sm text-muted">No conference events yet.</p>
        ) : (
          <ul className="mt-2 space-y-1 text-body-sm text-muted">
            {data.history.slice(-10).map((entry, index) => (
              <li key={`${entry.turn}-${index}`}>
                Turn {entry.turn} ({entry.kind}): {entry.detail}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
