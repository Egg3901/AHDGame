"use client";

/**
 * Loading state shaped like the real page, so nothing jumps when data lands.
 * Replaces the old "Loading elections..." text panel.
 */

import { Skeleton } from "@/components/ui";

export function ElectionsSkeleton() {
  return (
    <div className="space-y-8" aria-busy="true" aria-label="Loading elections">
      <div className="overflow-hidden rounded-2xl border border-card-border bg-card">
        <Skeleton className="h-[175px] w-full rounded-none sm:h-[220px]" />
        <div className="grid grid-cols-3 divide-x divide-card-border border-t border-card-border">
          {[0, 1, 2].map((i) => (
            <div key={i} className="space-y-2 px-5 py-3">
              <Skeleton className="h-2.5 w-16" />
              <Skeleton className="h-4 w-12" />
            </div>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap gap-3">
        {["w-24", "w-36", "w-32", "w-28", "w-24"].map((w, i) => (
          <Skeleton key={i} className={`h-9 rounded-lg ${w}`} />
        ))}
      </div>

      <div className="space-y-6">
        {[0, 1, 2].map((i) => (
          <div key={i} className="space-y-3">
            <Skeleton className="h-16 w-full rounded-xl" />
            {i === 0 && <Skeleton className="h-52 w-full rounded-xl" />}
          </div>
        ))}
      </div>
    </div>
  );
}
