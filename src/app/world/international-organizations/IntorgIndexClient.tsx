"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Skeleton } from "@/components/ui";
import { useWorldView } from "./useWorldView";
import { orgHref } from "./orgRouting";
import { OrgDirectory } from "./components/OrgDirectory";
import { YourDelegations } from "./components/YourDelegations";
import { CreateOrgForm } from "./components/CreateOrgForm";
import { GlobalResolutionsFeed } from "./components/GlobalResolutionsFeed";
import { OrgWorldMap } from "./components/OrgWorldMap";

/**
 * International Organizations index: the page header, your delegations, a create
 * flow, the cross-org resolutions feed, and the org directory. Each org links to
 * its own page. (The world map mounts here in Phase 2.)
 */
export default function IntorgIndexClient() {
  const router = useRouter();
  const { data, viewer, loading } = useWorldView();
  const orgs = data?.organizations ?? [];

  return (
    <div className="min-h-screen bg-background pb-16">
      <div className="mx-auto max-w-7xl space-y-6 px-4 py-6 sm:px-6">
        {/* Page header */}
        <header className="rounded-2xl border border-card-border bg-card p-5 shadow-card sm:p-6">
          <Link
            href="/world"
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
            World
          </Link>
          <div className="mt-2 flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-widest text-muted">
                Diplomacy
              </p>
              <h1 className="text-3xl font-bold text-foreground sm:text-4xl">
                International Organizations
              </h1>
              <p className="mt-1 max-w-2xl text-sm text-muted">
                Multilateral institutions, free-trade agreements, and elected leadership. Foreign
                ministers may apply to join, propose legislation, and vote on behalf of their
                country.
              </p>
            </div>
            {viewer &&
              (viewer.foreignMinisterCountryName || viewer.headOfGovernmentCountryName) && (
                <div className="rounded-lg border border-secondary/30 bg-secondary/10 px-3 py-2 text-xs">
                  <p className="font-semibold uppercase tracking-widest text-secondary">
                    Diplomatic Role
                  </p>
                  <p className="mt-0.5 text-foreground">
                    {viewer.foreignMinisterCountryName
                      ? `Foreign Minister of ${viewer.foreignMinisterCountryName}`
                      : `Head of Government of ${viewer.headOfGovernmentCountryName}`}
                  </p>
                </div>
              )}
          </div>
        </header>

        {loading ? (
          <div className="space-y-4">
            <Skeleton className="h-40 w-full rounded-2xl" />
            <Skeleton className="h-32 w-full rounded-xl" />
            <Skeleton className="h-32 w-full rounded-xl" />
          </div>
        ) : !data ? (
          <div className="rounded-xl border border-card-border bg-card p-8 text-center text-sm text-muted">
            Could not load organizations. Try refreshing.
          </div>
        ) : (
          <>
            <OrgWorldMap orgs={orgs} />
            <CreateOrgForm viewer={viewer} onCreated={(id) => router.push(orgHref({ id }))} />
            <YourDelegations orgs={orgs} viewer={viewer} />
            <OrgDirectory orgs={orgs} viewer={viewer} />
            <GlobalResolutionsFeed orgs={orgs} currentTurn={data.currentTurn} />
          </>
        )}
      </div>
    </div>
  );
}
