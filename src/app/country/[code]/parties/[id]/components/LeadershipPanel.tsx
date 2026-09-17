"use client";

import { useCallback, useEffect, useState } from "react";
import { getMessageStyle } from "@/lib/utils/formatters";

interface CommitteeMemberView {
  characterId: string;
  name: string;
  role: "chair" | "viceChair" | "treasurer" | "member";
  faction: string | null;
}

interface LeadershipState {
  partyName: string;
  family: string;
  committeeName: string;
  ruleset: {
    triggerThresholdPct: number;
    electorate: "mps" | "members";
    removalMajorityPct: number;
    survivalImmunityTurns: number;
  };
  leader: { characterId: string; name: string } | null;
  committee: {
    members: CommitteeMemberView[];
    control: {
      totalSeats: number;
      leadingFaction: string | null;
      leadingSeats: number;
      majorityHeld: boolean;
    };
  };
  immunity: { protected: boolean; turnsRemaining: number };
  amendment: { canAmendNow: boolean; turnsUntilAmendable: number };
  activeChallenge: {
    challengeId: string;
    status: string;
    targetName: string;
    backers: { characterId: string; characterName: string }[];
    backersNeeded: number;
    totalMps: number;
    ballot: {
      electorate: "mps" | "members";
      votesFor: number;
      votesAgainst: number;
      closesOnTurn: number;
      turnsRemaining: number;
    } | null;
  } | null;
  capabilities: {
    isPartyMember: boolean;
    isCommitteeMember: boolean;
    isPartyMp: boolean;
    canInitiate: boolean;
  };
  history: { turn: number; at: string; kind: string; actorName?: string; detail: string }[];
}

export function LeadershipPanel({
  countryCode,
  partyId,
}: {
  countryCode: string;
  partyId: string;
}) {
  const [data, setData] = useState<LeadershipState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [acting, setActing] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [trigger, setTrigger] = useState("");
  const [majority, setMajority] = useState("");
  const [immunityTurns, setImmunityTurns] = useState("");
  const [electorate, setElectorate] = useState<"mps" | "members">("mps");

  const baseUrl = `/api/country/${countryCode.toLowerCase()}/parties/${partyId}/leadership`;

  const fetchState = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(baseUrl, { credentials: "same-origin" });
      if (!res.ok) {
        const payload = await res.json().catch(() => null);
        setError(payload?.error ?? "Failed to load leadership state");
        return;
      }
      const state = (await res.json()) as LeadershipState;
      setData(state);
      setElectorate(state.ruleset.electorate);
    } catch {
      setError("Network error loading leadership state");
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

  if (loading && !data) {
    return (
      <div className="space-y-3" aria-busy="true" aria-label="Loading leadership">
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
  const challenge = data.activeChallenge;

  return (
    <div className="space-y-6">
      <div aria-live="polite" className={getMessageStyle(message)} role="status">
        {message}
      </div>

      <section aria-label="Party leadership" className="rounded-lg border border-card-border p-4">
        <h3 className="text-heading-sm font-bold">
          {data.committeeName}: {data.leader ? data.leader.name : "Vacant"}
        </h3>
        <p className="mt-1 text-body-sm text-muted">
          {data.leader
            ? `Sitting party leader. A successful challenge vacates the chair; the existing chair election seats the successor. The government is unaffected.`
            : `The chair is vacant; a chair election seats the successor.`}
        </p>
        {data.immunity.protected && (
          <p className="mt-2 text-body-sm text-warning">
            The leader survived a recent ballot and is immune for {data.immunity.turnsRemaining}{" "}
            more turn(s).
          </p>
        )}
        <dl className="mt-3 grid grid-cols-2 gap-2 text-body-sm sm:grid-cols-4">
          <div>
            <dt className="text-muted">Trigger</dt>
            <dd>{(data.ruleset.triggerThresholdPct * 100).toFixed(0)}% of MPs</dd>
          </div>
          <div>
            <dt className="text-muted">Ballot electorate</dt>
            <dd>{data.ruleset.electorate === "mps" ? "MPs" : "All members"}</dd>
          </div>
          <div>
            <dt className="text-muted">Removal needs</dt>
            <dd>over {(data.ruleset.removalMajorityPct * 100).toFixed(0)}% to remove</dd>
          </div>
          <div>
            <dt className="text-muted">Survival immunity</dt>
            <dd>{data.ruleset.survivalImmunityTurns} turns</dd>
          </div>
        </dl>
      </section>

      <section
        aria-label="Governing committee"
        className="rounded-lg border border-card-border p-4"
      >
        <h3 className="text-heading-sm font-bold">
          {data.committeeName} ({data.committee.control.totalSeats} seats)
        </h3>
        <p className="mt-1 text-body-sm text-muted">
          {data.committee.control.leadingFaction
            ? `Leading faction: ${data.committee.control.leadingFaction} (${data.committee.control.leadingSeats} seats${data.committee.control.majorityHeld ? ", majority" : ", no majority"})`
            : `No faction alignment recorded`}
        </p>
        <ul className="mt-3 space-y-1 text-body-sm">
          {data.committee.members.map((m) => (
            <li key={m.characterId} className="flex justify-between gap-2">
              <span>
                {m.name} <span className="text-muted">({m.role})</span>
              </span>
              <span className="text-muted">{m.faction ?? "unaligned"}</span>
            </li>
          ))}
          {data.committee.members.length === 0 && (
            <li className="text-muted">No committee seats filled.</li>
          )}
        </ul>

        {data.capabilities.isCommitteeMember && (
          <form
            className="mt-4 space-y-2 border-t border-card-border pt-4"
            onSubmit={(e) => {
              e.preventDefault();
              const patch: Record<string, number | string> = {};
              if (trigger.trim() !== "") patch.triggerThresholdPct = Number(trigger);
              if (majority.trim() !== "") patch.removalMajorityPct = Number(majority);
              if (immunityTurns.trim() !== "") patch.survivalImmunityTurns = Number(immunityTurns);
              if (electorate !== data.ruleset.electorate) patch.electorate = electorate;
              void runAction(
                "amend",
                `${baseUrl}/rules`,
                {
                  method: "PATCH",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify(patch),
                },
                "Rules amended."
              );
            }}
          >
            <h4 className="font-semibold">Amend removal rules</h4>
            {!data.amendment.canAmendNow && (
              <p className="text-body-sm text-warning">
                Recently amended; available again in {data.amendment.turnsUntilAmendable} turn(s).
              </p>
            )}
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <label className="text-body-sm">
                Trigger (0.05-0.5)
                <input
                  className="mt-1 w-full rounded-md border border-card-border bg-background px-2 py-1"
                  value={trigger}
                  onChange={(e) => setTrigger(e.target.value)}
                  inputMode="decimal"
                  placeholder={String(data.ruleset.triggerThresholdPct)}
                />
              </label>
              <label className="text-body-sm">
                Majority (over 0.5-0.75)
                <input
                  className="mt-1 w-full rounded-md border border-card-border bg-background px-2 py-1"
                  value={majority}
                  onChange={(e) => setMajority(e.target.value)}
                  inputMode="decimal"
                  placeholder={String(data.ruleset.removalMajorityPct)}
                />
              </label>
              <label className="text-body-sm">
                Immunity turns (0-96)
                <input
                  className="mt-1 w-full rounded-md border border-card-border bg-background px-2 py-1"
                  value={immunityTurns}
                  onChange={(e) => setImmunityTurns(e.target.value)}
                  inputMode="numeric"
                  placeholder={String(data.ruleset.survivalImmunityTurns)}
                />
              </label>
              <label className="text-body-sm">
                Electorate
                <select
                  className="mt-1 w-full rounded-md border border-card-border bg-background px-2 py-1"
                  value={electorate}
                  onChange={(e) => setElectorate(e.target.value as "mps" | "members")}
                >
                  <option value="mps">MPs</option>
                  <option value="members">All members</option>
                </select>
              </label>
            </div>
            <button
              type="submit"
              disabled={busy || !data.amendment.canAmendNow}
              title={
                data.amendment.canAmendNow
                  ? "Amend the removal rules"
                  : "Cooling down after the last amendment"
              }
              className="rounded-md border border-card-border px-3 py-1.5 text-body-sm font-semibold hover:bg-background disabled:cursor-not-allowed disabled:opacity-50"
            >
              {acting === "amend" ? "Amending..." : "Amend rules"}
            </button>
          </form>
        )}
      </section>

      <section
        aria-label="Leadership challenge"
        className="rounded-lg border border-card-border p-4"
      >
        <h3 className="text-heading-sm font-bold">Leadership challenge</h3>
        {!challenge && (
          <>
            <p className="mt-1 text-body-sm text-muted">
              No live challenge. Letters (CON-style) or nominations (LAB-style) come from sitting
              MPs of this party.
            </p>
            <button
              type="button"
              disabled={busy || !data.capabilities.canInitiate}
              title={
                data.capabilities.canInitiate
                  ? "File the first letter against the sitting leader"
                  : !data.capabilities.isPartyMp
                    ? "Only a sitting MP of this party can challenge"
                    : !data.leader
                      ? "There is no sitting leader to challenge"
                      : data.immunity.protected
                        ? "The leader is within their survival-immunity window"
                        : "A challenge is already in progress"
              }
              onClick={() =>
                void runAction(
                  "initiate",
                  `${baseUrl}/challenge`,
                  { method: "POST", headers: { "Content-Type": "application/json" } },
                  "Challenge filed."
                )
              }
              className="mt-3 rounded-md border border-card-border px-3 py-1.5 text-body-sm font-semibold hover:bg-background disabled:cursor-not-allowed disabled:opacity-50"
            >
              {acting === "initiate" ? "Filing..." : "Challenge the leader"}
            </button>
          </>
        )}
        {challenge && (
          <div className="mt-2 space-y-3 text-body-sm">
            <p>
              <strong>{challenge.targetName}</strong> is under challenge ({challenge.status}).
              Backers: {challenge.backers.length}/{challenge.totalMps} MPs
              {challenge.status === "gathering" &&
                `, ${challenge.backersNeeded} more to force a ballot`}
              .
            </p>
            <ul className="space-y-1">
              {challenge.backers.map((b) => (
                <li key={b.characterId} className="text-muted">
                  {b.characterName}
                </li>
              ))}
            </ul>
            {challenge.status === "gathering" && data.capabilities.isPartyMp && (
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    void runAction(
                      "back",
                      `${baseUrl}/challenge/back`,
                      {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ back: true }),
                      },
                      "Letter added."
                    )
                  }
                  className="rounded-md border border-card-border px-3 py-1.5 font-semibold hover:bg-background disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {acting === "back" ? "Backing..." : "Back the challenge"}
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    void runAction(
                      "withdraw",
                      `${baseUrl}/challenge/back`,
                      {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ back: false }),
                      },
                      "Backing withdrawn."
                    )
                  }
                  className="rounded-md border border-card-border px-3 py-1.5 font-semibold hover:bg-background disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {acting === "withdraw" ? "Withdrawing..." : "Withdraw backing"}
                </button>
              </div>
            )}
            {challenge.ballot && (
              <div className="border-t border-card-border pt-3">
                <p>
                  Ballot ({challenge.ballot.electorate === "mps" ? "MPs vote" : "members vote"}):{" "}
                  {challenge.ballot.votesFor} remove / {challenge.ballot.votesAgainst} retain,
                  closes in {challenge.ballot.turnsRemaining} turn(s).
                </p>
                <div className="mt-2 flex gap-2">
                  {(["aye", "nay"] as const).map((vote) => (
                    <button
                      key={vote}
                      type="button"
                      disabled={busy || !data.capabilities.isPartyMember}
                      title={
                        data.capabilities.isPartyMember
                          ? vote === "aye"
                            ? "Vote to remove the leader"
                            : "Vote to retain the leader"
                          : "Only party members vote in this ballot"
                      }
                      onClick={() =>
                        void runAction(
                          `vote-${vote}`,
                          `${baseUrl}/ballot/vote`,
                          {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ challengeId: challenge.challengeId, vote }),
                          },
                          vote === "aye" ? "Voted to remove." : "Voted to retain."
                        )
                      }
                      className="rounded-md border border-card-border px-3 py-1.5 font-semibold hover:bg-background disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {acting === `vote-${vote}`
                        ? "Voting..."
                        : vote === "aye"
                          ? "Remove"
                          : "Retain"}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </section>

      <section aria-label="Leadership history" className="rounded-lg border border-card-border p-4">
        <h3 className="text-heading-sm font-bold">Recent history</h3>
        <ul className="mt-2 space-y-1 text-body-sm text-muted">
          {data.history
            .slice(-10)
            .reverse()
            .map((h, i) => (
              <li key={`${h.turn}-${i}`}>
                Turn {h.turn} [{h.kind}]: {h.detail}
              </li>
            ))}
          {data.history.length === 0 && <li>No recorded events.</li>}
        </ul>
      </section>
    </div>
  );
}
