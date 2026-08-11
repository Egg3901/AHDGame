"use client";

import { EmptyState, Skeleton } from "@/components/ui";
import { CoalitionCard } from "./CoalitionCard";
import type { CoalitionListItem } from "../coalitionTypes";

interface CoalitionsTabProps {
  coalitions: CoalitionListItem[];
  loading: boolean;
  effectiveCountry: string;
}

export function CoalitionsTab({ coalitions, loading, effectiveCountry }: CoalitionsTabProps) {
  if (loading) {
    return (
      <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="rounded-xl border border-card-border bg-card p-5">
            <Skeleton className="h-12 w-12 rounded-full mb-3" />
            <Skeleton className="h-5 w-2/3 mb-2" />
            <Skeleton className="h-4 w-full mb-1" />
            <Skeleton className="h-4 w-1/2" />
          </div>
        ))}
      </div>
    );
  }

  if (coalitions.length === 0) {
    return (
      <div className="rounded-xl border border-card-border bg-card p-12">
        <EmptyState
          title="No coalitions formed yet"
          description="National party chairs can create coalitions to unite multiple parties under a common banner."
        />
      </div>
    );
  }

  const totalMembers = coalitions.reduce((sum, coalition) => sum + coalition.totalMembers, 0);
  const largestCoalition = [...coalitions].sort((a, b) => b.totalMembers - a.totalMembers)[0];

  return (
    <section aria-labelledby="coalition-roster-title">
      <div className="mb-4 grid overflow-hidden rounded-xl border border-card-border bg-card shadow-card sm:grid-cols-3">
        <div className="p-5 sm:col-span-2">
          <p className="text-body-xs font-bold uppercase tracking-widest text-muted">
            Alliance landscape
          </p>
          <h2 className="mt-1 text-heading-lg font-extrabold">Coalition blocs</h2>
          <p className="mt-2 max-w-2xl text-body-sm text-muted">
            Coalitions unite party organizations and membership under a shared national banner.
          </p>
        </div>
        <div className="grid grid-cols-2 border-t border-card-border bg-card-muted/40 sm:border-l sm:border-t-0">
          <div className="p-4">
            <p className="text-body-xs text-muted">Largest bloc</p>
            <p className="mt-1 truncate text-heading font-bold">{largestCoalition.abbreviation}</p>
          </div>
          <div className="border-l border-card-border p-4">
            <p className="text-body-xs text-muted">Members</p>
            <p className="mt-1 text-heading font-bold tabular-nums">
              {totalMembers.toLocaleString("en-US")}
            </p>
          </div>
        </div>
      </div>
      <div className="mb-3 flex items-end justify-between gap-4">
        <h2 id="coalition-roster-title" className="text-heading font-bold">
          Active coalitions
        </h2>
        <span className="font-mono text-body-sm text-muted">{coalitions.length} total</span>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        {coalitions.map((coalition) => (
          <CoalitionCard
            key={coalition.id}
            coalition={coalition}
            effectiveCountry={effectiveCountry}
          />
        ))}
      </div>
    </section>
  );
}
