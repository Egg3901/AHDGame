import { Skeleton, CardSkeleton } from "@/components/ui";

/**
 * Shared skeleton for the AdminTabs content area.
 * Used by both admin/loading.tsx (server Suspense boundary) and
 * admin/page.tsx (client-side <Suspense> fallback for AdminTabs).
 * Both must show the same shape to avoid a visual flash.
 */
export function AdminTabsSkeleton() {
  return (
    <div className="mx-auto max-w-7xl px-3 sm:px-6 py-6">
      <CardSkeleton>
        {/* Tab row */}
        <div className="border-b border-card-border mb-5">
          <div className="flex gap-6 pb-0.5 overflow-x-auto">
            {[1, 2, 3, 4].map((i) => (
              <Skeleton key={i} className="h-9 w-20 shrink-0" />
            ))}
          </div>
        </div>
        {/* Content area */}
        <div className="space-y-4">
          <Skeleton className="h-5 w-48" />
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="rounded-lg border border-card-border p-4 space-y-2">
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-6 w-16" />
                <Skeleton className="h-3 w-20" />
              </div>
            ))}
          </div>
        </div>
      </CardSkeleton>
    </div>
  );
}
