"use client";

import Link from "next/link";
import type { OrgSummary } from "../orgTypes";
import { orgHref } from "../orgRouting";
import { orgAccentStyle } from "./orgTheme";
import { Seal } from "./OrgPrimitives";

export type OrgCardBadge = "founding" | "active" | "pending";

function badgeMeta(badge: OrgCardBadge): { label: string; cls: string } {
  if (badge === "pending") {
    return { label: "Applied", cls: "border-warning/30 bg-warning/10 text-warning" };
  }
  if (badge === "founding") {
    return { label: "Founding", cls: "border-success/30 bg-success/10 text-success" };
  }
  return { label: "Member", cls: "border-success/30 bg-success/10 text-success" };
}

/**
 * Shared organization card: seal, name + short name, an optional membership
 * badge, and a members / standing stat row. Used by both the directory and the
 * your-delegations section so they read identically. The whole card links to the
 * org's page.
 */
export function OrgCard({
  org,
  badge,
  ftaCount,
}: {
  org: OrgSummary;
  badge?: OrgCardBadge;
  ftaCount?: number;
}) {
  const meta = badge ? badgeMeta(badge) : null;
  return (
    <Link
      href={orgHref(org)}
      style={orgAccentStyle(org.identity)}
      className="card-hover rounded-xl border bg-card p-4 shadow-card"
    >
      <div className="flex items-center gap-3">
        <Seal identity={org.identity} size={40} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold text-foreground">{org.def.name}</div>
          <div className="truncate text-[11px] text-muted">{org.def.shortName}</div>
        </div>
        {meta && (
          <span
            className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-medium ${meta.cls}`}
          >
            {meta.label}
          </span>
        )}
      </div>
      <div className="mt-3 flex gap-3 text-[11px] text-muted">
        <span>
          <span className="font-bold tabular-nums text-foreground">{org.members.length}</span>{" "}
          members
        </span>
        <span>
          <span className="font-bold tabular-nums text-foreground">
            {org.derived.worldEconomySharePct}%
          </span>{" "}
          of world economy
        </span>
        {ftaCount != null && ftaCount > 0 && (
          <span>
            <span className="font-bold tabular-nums text-foreground">{ftaCount}</span> FTAs
          </span>
        )}
      </div>
    </Link>
  );
}
