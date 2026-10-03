"use client";

import { EmptyState, Skeleton } from "@/components/ui";
import { CoalitionCard } from "./CoalitionCard";
import type { CoalitionListItem } from "../coalitionTypes";
import {
  PARTY_LABEL_CLASS,
  PARTY_SECTION_HEADING_CLASS,
  PARTY_VALUE_CLASS,
} from "@/components/party/partyPageStyles";

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
    <div className="space-y-12">
      <section aria-labelledby="coalition-blocs-title">
        <h2 id="coalition-blocs-title" className={PARTY_SECTION_HEADING_CLASS}>
          Coalition blocs
        </h2>
        <p className="mt-1 max-w-2xl text-body text-muted">
          Coalitions unite party organizations and membership under a shared national banner.
        </p>
        <dl className="mt-4 flex flex-wrap gap-x-10 gap-y-3">
          <div className="min-w-0">
            <dt className={PARTY_LABEL_CLASS}>Largest bloc</dt>
            <dd className={`truncate ${PARTY_VALUE_CLASS}`}>{largestCoalition.abbreviation}</dd>
          </div>
          <div>
            <dt className={PARTY_LABEL_CLASS}>Members</dt>
            <dd className={PARTY_VALUE_CLASS}>{totalMembers.toLocaleString("en-US")}</dd>
          </div>
        </dl>
      </section>

      <section aria-labelledby="coalition-roster-title">
        <div className="mb-4 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <h2 id="coalition-roster-title" className={PARTY_SECTION_HEADING_CLASS}>
            Active coalitions
          </h2>
          <p className="text-body-sm text-muted">{coalitions.length} total</p>
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
    </div>
  );
}
