"use client";

import type { CaucusDetail } from "./caucusTypes";
import { caucusHealthTone, formatCaucusChurnKind } from "./caucusUtils";
import { LocalTime } from "@/components/time/LocalTime";

export function OverviewSubtab({ detail }: { detail: CaucusDetail }) {
  const health = detail.health;

  return (
    <div className="space-y-4">
      {health && (
        <>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <div className="rounded-lg border border-card-border bg-card p-4">
              <div className="text-[11px] font-semibold uppercase tracking-widest text-muted">
                Caucus Status
              </div>
              <div className="mt-3 flex items-center gap-2">
                <span
                  className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${caucusHealthTone(health.statusLabel)}`}
                >
                  {health.statusLabel}
                </span>
                <span className="text-xs text-muted">
                  {health.chairVacant
                    ? "Chair vacant"
                    : health.election.status === "active"
                      ? "Election active"
                      : "Chair seated"}
                </span>
              </div>
              <p className="mt-3 text-sm text-muted">{health.statusReason}</p>
            </div>

            <div className="rounded-lg border border-card-border bg-card p-4">
              <div className="text-[11px] font-semibold uppercase tracking-widest text-muted">
                Churn | Last {12} turns
              </div>
              <div className="mt-3 grid grid-cols-3 gap-3 text-sm">
                <div>
                  <div className="font-bold text-success tabular-nums">
                    {health.recentJoinCount}
                  </div>
                  <div className="text-[11px] text-muted">Joins</div>
                </div>
                <div>
                  <div className="font-bold text-warning tabular-nums">
                    {health.recentLeaveCount}
                  </div>
                  <div className="text-[11px] text-muted">Leaves</div>
                </div>
                <div>
                  <div className="font-bold text-error tabular-nums">
                    {health.recentForcedExitCount}
                  </div>
                  <div className="text-[11px] text-muted">Forced</div>
                </div>
              </div>
            </div>

            <div className="rounded-lg border border-card-border bg-card p-4">
              <div className="text-[11px] font-semibold uppercase tracking-widest text-muted">
                Discipline
              </div>
              <div className="mt-3 grid grid-cols-3 gap-3 text-sm">
                <div>
                  <div className="font-bold tabular-nums">{health.activeDefianceCount}</div>
                  <div className="text-[11px] text-muted">Defying</div>
                </div>
                <div>
                  <div className="font-bold tabular-nums">{health.playerDefianceCount}</div>
                  <div className="text-[11px] text-muted">Players</div>
                </div>
                <div>
                  <div className="font-bold tabular-nums">{health.nppDefianceCount}</div>
                  <div className="text-[11px] text-muted">NPPs</div>
                </div>
              </div>
            </div>

            <div className="rounded-lg border border-card-border bg-card p-4">
              <div className="text-[11px] font-semibold uppercase tracking-widest text-muted">
                Chair Election
              </div>
              <div className="mt-3 text-sm">
                <div className="font-bold">
                  {health.election.status === "active"
                    ? "Voting now"
                    : health.election.status === "recently_completed"
                      ? "Recently completed"
                      : "Idle"}
                </div>
                <div className="mt-1 text-[11px] text-muted">
                  {health.election.status === "active" && health.election.endTurn !== null
                    ? `Closes on turn ${health.election.endTurn}`
                    : health.election.winnerName
                      ? `Last winner: ${health.election.winnerName}`
                      : "No recent caucus chair election on file."}
                </div>
                {(health.election.candidateCount > 0 || health.election.totalVotes > 0) && (
                  <div className="mt-2 text-[11px] text-muted">
                    {health.election.candidateCount} candidate(s) | {health.election.totalVotes}{" "}
                    vote(s)
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="grid gap-4 xl:grid-cols-2">
            <div className="rounded-lg border border-card-border bg-card p-5">
              <h3 className="mb-3 text-[11px] font-semibold uppercase tracking-widest text-muted">
                At-Risk NPP Members
              </h3>
              {health.atRiskMembers.length === 0 ? (
                <p className="text-sm italic text-muted">
                  No caucus NPPs are close to the chair-relationship exit threshold.
                </p>
              ) : (
                <ul className="space-y-2">
                  {health.atRiskMembers.map((member) => (
                    <li
                      key={member.nppId}
                      className="flex items-center justify-between gap-3 rounded border border-card-border bg-background/50 p-3"
                    >
                      <div>
                        <div className="text-sm font-semibold">{member.nppName}</div>
                        <div className="text-[11px] text-muted">
                          Relationship {member.relationshipWithChair.toFixed(1)} | Exit in{" "}
                          {member.gapFromExit.toFixed(1)}
                        </div>
                      </div>
                      <span
                        className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${caucusHealthTone(
                          member.exitRiskLabel === "Critical"
                            ? "Fragile"
                            : member.exitRiskLabel === "Elevated"
                              ? "Strained"
                              : "Healthy"
                        )}`}
                      >
                        {member.exitRiskLabel}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="rounded-lg border border-card-border bg-card p-5">
              <h3 className="mb-3 text-[11px] font-semibold uppercase tracking-widest text-muted">
                Recent Churn
              </h3>
              {health.recentChurn.length === 0 ? (
                <p className="text-sm italic text-muted">
                  No joins, leaves, or forced exits in the last 12 turns.
                </p>
              ) : (
                <ul className="space-y-2">
                  {health.recentChurn.map((entry) => (
                    <li
                      key={entry.id}
                      className="flex items-center justify-between gap-3 rounded border border-card-border bg-background/50 p-3"
                    >
                      <div>
                        <div className="text-sm font-semibold">{entry.memberName}</div>
                        <div className="text-[11px] text-muted">
                          {entry.memberType === "character" ? "Player" : "NPP"} |{" "}
                          {formatCaucusChurnKind(entry.kind)}
                        </div>
                      </div>
                      <div className="text-right text-[11px] text-muted">
                        <LocalTime
                          value={entry.occurredAt}
                          options={{ dateStyle: "medium", timeStyle: "short" }}
                        />
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </>
      )}

      <div className="rounded-lg border border-card-border bg-card p-5">
        <h3 className="mb-3 text-[11px] font-semibold uppercase tracking-widest text-muted">
          Key policy positions
        </h3>
        {detail.positions.length === 0 ? (
          <p className="text-sm italic text-muted">No positions defined yet.</p>
        ) : (
          <ul className="space-y-2">
            {detail.positions.map((position) => (
              <li
                key={position.id}
                className="flex items-start gap-3 rounded border border-card-border bg-background/50 p-3"
              >
                <span
                  className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${
                    position.weight === "core"
                      ? "border-red-500/40 bg-red-500/10 text-red-300"
                      : "border-card-border text-muted"
                  }`}
                >
                  {position.weight}
                </span>
                <div className="flex-1">
                  <div className="flex flex-wrap items-baseline gap-2">
                    <span className="text-sm font-semibold">{position.topic}</span>
                    <span className="text-xs text-muted">to</span>
                    <span className="text-sm text-primary">{position.stance}</span>
                  </div>
                  {position.note && <p className="mt-1 text-[11px] text-muted">{position.note}</p>}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
