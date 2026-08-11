"use client";

import Link from "next/link";
import { useParams, notFound } from "next/navigation";
import { Skeleton } from "@/components/ui";
import { useWorldView } from "../useWorldView";
import { resolveOrgBySegment } from "../orgRouting";
import { OrgProvider } from "../OrgProvider";
import { OrgMasthead } from "../components/OrgMasthead";
import { orgAccentStyle } from "../components/orgTheme";

/**
 * Per-org layout: fetches the world view once, resolves the org from the
 * (case-insensitive) `[orgId]` segment, renders the masthead + routed sub-tabs,
 * and provides the org/viewer/turn context to the overview / flagship pages.
 */
export default function OrgLayout({ children }: { children: React.ReactNode }) {
  const params = useParams<{ orgId: string }>();
  const { data, viewer, loading, refresh } = useWorldView();

  if (loading) {
    return (
      <div className="mx-auto max-w-7xl space-y-4 px-4 py-6 sm:px-6">
        <Skeleton className="h-40 w-full rounded-2xl" />
        <Skeleton className="h-64 w-full rounded-xl" />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
        <Link
          href="/world/international-organizations"
          className="mb-4 inline-flex items-center gap-1.5 text-xs font-medium text-muted hover:text-foreground"
        >
          ← All organizations
        </Link>
        <div className="rounded-xl border border-card-border bg-card p-8 text-center text-sm text-muted">
          Could not load this organization. Try refreshing.
        </div>
      </div>
    );
  }

  const org = resolveOrgBySegment(data.organizations, params.orgId);
  if (!org) notFound();

  return (
    <div className="min-h-screen bg-background pb-16">
      <div className="mx-auto max-w-7xl space-y-5 px-4 py-6 sm:px-6">
        <Link
          href="/world/international-organizations"
          className="inline-flex items-center gap-1.5 text-xs font-medium text-muted hover:text-foreground"
        >
          <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M15 19l-7-7 7-7"
            />
          </svg>
          All organizations
        </Link>
        <div style={orgAccentStyle(org.identity)} className="space-y-5">
          <OrgMasthead
            org={org}
            viewer={viewer}
            alignmentEnabled={data.intOrgAlignmentEnabled === true}
          />
          <OrgProvider
            value={{
              org,
              viewer,
              currentTurn: data.currentTurn,
              votingWindowTurns: data.proposalVotingWindowTurns,
              refresh,
            }}
          >
            {children}
          </OrgProvider>
        </div>
      </div>
    </div>
  );
}
