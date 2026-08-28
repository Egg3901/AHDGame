"use client";

import { Badge } from "@/components/ui";
import type { OrgSummary } from "../orgTypes";

const STATUS_LABEL = {
  joined: "Joined",
  pending: "Vote open",
  approved: "Approved",
  failed: "Rejected",
  opposing: "Opposing side",
  awaiting: "No bill",
} as const;

function joinNames(names: string[]): string {
  if (names.length < 2) return names[0] ?? "the opposing coalition";
  return `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}

export function WarEntryStatusPanel({ org }: { org: OrgSummary }) {
  const operations = org.warEntryOperations ?? [];
  if (operations.length === 0) return null;
  const memberById = new Map(org.members.map((member) => [member.countryId, member] as const));

  return (
    <div className="rounded-xl border border-card-border bg-card p-4">
      <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-muted">War entry</div>
      {operations.map((operation) => (
        <div key={operation.resolutionId} className="mt-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <div className="text-sm font-semibold text-foreground">{operation.conflictName}</div>
              <div className="text-[11px] text-muted">
                {operation.militaryOrganizationId === org.id
                  ? operation.militaryOrganizationId
                  : `${operation.militaryOrganizationId} military status`}
                {" · Alliance call enacted · "}
                {operation.stake === "collective_defense"
                  ? "Collective defense, immediate entry"
                  : operation.stake === "offensive_coalition"
                    ? "Offensive coalition, national votes required"
                    : "Discretionary coalition entry"}
              </div>
              <div className="mt-0.5 text-[11px] text-muted">
                Entry means war with {joinNames(operation.opposingNames)}
              </div>
            </div>
            <Badge
              color={operation.stake === "collective_defense" ? "error" : "warning"}
              variant="subtle"
            >
              {operation.conflictStatus.replace(/_/g, " ")}
            </Badge>
          </div>
          <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {operation.members.map((entry) => {
              const member = memberById.get(entry.countryId);
              return (
                <div
                  key={entry.countryId}
                  className="rounded-lg border border-card-border bg-card-muted px-3 py-2"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0 truncate text-[13px] font-semibold text-foreground">
                      {member?.flagEmoji} {member?.countryName ?? entry.countryId}
                    </div>
                    <span className="shrink-0 text-[10px] font-semibold uppercase tracking-wide text-muted">
                      {entry.stake === "offensive_coalition" && entry.status === "pending"
                        ? "National vote open"
                        : STATUS_LABEL[entry.status]}
                    </span>
                  </div>
                  {entry.status === "pending" && entry.lower && (
                    <div className="mt-1 text-[11px] tabular-nums text-muted">
                      Lower {entry.lower.for} for, {entry.lower.against} against
                      {entry.upper
                        ? ` · Upper ${entry.upper.for} for, ${entry.upper.against} against`
                        : ""}
                    </div>
                  )}
                  {entry.stake === "principal_belligerent" && (
                    <div className="mt-1 text-[11px] text-muted">Principal belligerent</div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
