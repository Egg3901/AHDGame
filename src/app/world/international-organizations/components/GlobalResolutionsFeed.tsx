"use client";

import { useState } from "react";
import Link from "next/link";
import type { OrganizationResolutionType } from "@/lib/db/types/internationalOrganization";
import type { OrgSummary } from "../orgTypes";
import { orgHref } from "../orgRouting";
import { buildResolutionFeed } from "./resolutionFeed";

const PAGE_SIZE = 10;

/**
 * Keyed by `OrganizationResolutionType`, not `string`: a missing entry falls
 * through to the raw enum value below, so a new resolution type would otherwise
 * ship into the feed reading "join_conflict" with nothing failing. Typed this way
 * it does not compile until the label exists.
 */
const TYPE_LABEL: Record<OrganizationResolutionType, string> = {
  free_trade_agreement: "Free-trade agreement",
  sanctions: "Sanctions",
  directive: "Directive",
  joint_statement: "Joint statement",
  aid_package: "Aid package",
  set_dues: "Dues change",
  set_posture: "Alert posture",
  fund_agency: "Agency funding",
  join_conflict: "Entry into a conflict",
};

/** Cross-org activity feed: pending votes + active resolutions across every org. */
export function GlobalResolutionsFeed({
  orgs,
  currentTurn,
}: {
  orgs: OrgSummary[];
  currentTurn: number;
}) {
  const feed = buildResolutionFeed(orgs);
  const [page, setPage] = useState(0);

  const pageCount = Math.max(1, Math.ceil(feed.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const visible = feed.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE);

  return (
    <section className="space-y-3">
      <h3 className="text-xs font-semibold uppercase tracking-widest text-muted">
        Across all organizations
      </h3>
      {feed.length === 0 ? (
        <div className="rounded-xl border border-card-border bg-card p-5">
          <p className="text-sm text-muted">No resolutions across organizations.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {visible.map((item) => {
            const turnsLeft =
              item.closesOnTurn != null ? Math.max(0, item.closesOnTurn - currentTurn) : null;
            return (
              <Link
                key={item._id}
                href={orgHref({ id: item.orgId })}
                className="card-hover flex flex-wrap items-center justify-between gap-2 rounded-lg border border-card-border bg-card p-3"
              >
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium text-foreground">{item.title}</div>
                  <div className="text-[11px] text-muted">
                    {item.orgShortName} · {TYPE_LABEL[item.type] ?? item.type}
                  </div>
                </div>
                {item.status === "pending" ? (
                  <span className="shrink-0 rounded-full border border-warning/30 bg-warning/10 px-2 py-0.5 text-[11px] font-medium text-warning">
                    Voting{turnsLeft != null ? ` · ${turnsLeft}t left` : ""}
                  </span>
                ) : (
                  <span className="shrink-0 rounded-full border border-success/30 bg-success/10 px-2 py-0.5 text-[11px] font-medium text-success">
                    In force
                  </span>
                )}
              </Link>
            );
          })}

          {pageCount > 1 && (
            <div className="flex items-center justify-between pt-1 text-xs text-muted">
              <span>
                {safePage * PAGE_SIZE + 1}–{safePage * PAGE_SIZE + visible.length} of {feed.length}
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setPage(safePage - 1)}
                  disabled={safePage === 0}
                  className="rounded-md border border-card-border px-2 py-1 font-medium text-foreground transition-colors hover:bg-card-elevated disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Previous
                </button>
                <span className="tabular-nums">
                  Page {safePage + 1} / {pageCount}
                </span>
                <button
                  type="button"
                  onClick={() => setPage(safePage + 1)}
                  disabled={safePage >= pageCount - 1}
                  className="rounded-md border border-card-border px-2 py-1 font-medium text-foreground transition-colors hover:bg-card-elevated disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
