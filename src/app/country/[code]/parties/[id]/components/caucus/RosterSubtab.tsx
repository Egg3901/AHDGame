"use client";

import type { RosterEntry } from "./caucusTypes";
import { toRoleLabel } from "./caucusUtils";

export function RosterSubtab({
  roster,
  filter,
  setFilter,
  counts,
}: {
  roster: RosterEntry[] | null;
  filter: "all" | "players" | "npps";
  setFilter: (v: "all" | "players" | "npps") => void;
  counts: { players: number; npps: number; total: number };
}) {
  return (
    <div className="rounded-lg border border-card-border bg-card p-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-[11px] font-semibold uppercase tracking-widest text-muted">Roster</h3>
        <div className="flex gap-1">
          {(
            [
              ["all", `All | ${counts.total}`],
              ["players", `Players | ${counts.players}`],
              ["npps", `NPPs | ${counts.npps}`],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setFilter(id)}
              className={`rounded border px-2.5 py-1 text-[11px] transition-colors ${
                filter === id
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-card-border text-muted hover:text-foreground"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      {!roster ? (
        <p className="text-sm italic text-muted">Loading roster...</p>
      ) : roster.length === 0 ? (
        <p className="text-sm italic text-muted">No members of this type.</p>
      ) : (
        <ul className="divide-y divide-card-border">
          {roster.map((entry) => (
            <li key={entry.membershipId} className="flex items-center justify-between gap-3 py-2">
              <div>
                <div className="text-sm font-medium">{entry.name}</div>
                <div className="text-[11px] text-muted">
                  {entry.memberType === "character" ? "Player" : "NPP"} | {entry.homeState}
                  {entry.role !== "member" && ` | ${toRoleLabel(entry.role)}`}
                </div>
              </div>
              <div className="text-right text-[11px]">
                {entry.complianceScore >= 0 ? (
                  <span>Compliance {entry.complianceScore}%</span>
                ) : (
                  <span className="italic text-muted">No whips on record</span>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
