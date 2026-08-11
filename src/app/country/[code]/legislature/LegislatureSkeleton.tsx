import { Skeleton, CardSkeleton, TabRowSkeleton, ListRowSkeleton } from "@/components/ui";

/**
 * Shared legislature page skeleton.
 * Used by the dynamic import Suspense fallback in LegislatureClient.tsx
 * and region/[id]/legislature/loading.tsx.
 */
export function LegislatureSkeleton() {
  return (
    <div className="min-h-screen bg-background">
      <main className="mx-auto max-w-7xl min-w-0 overflow-x-hidden px-4 sm:px-6 py-6 sm:py-10 space-y-8">
        {/* Hero header card */}
        <header className="relative overflow-hidden rounded-2xl border border-card-border bg-card shadow-lg">
          <div className="relative h-[175px] w-full sm:h-[220px]">
            <div className="absolute inset-0 flex flex-col justify-between px-5 sm:px-6 py-4 sm:py-5">
              <div className="flex items-center justify-between gap-2">
                <Skeleton className="h-8 w-8 rounded-lg" />
                <Skeleton className="h-8 w-24 rounded-lg" />
              </div>
              <div className="space-y-2">
                <Skeleton className="h-9 w-48 sm:w-72" />
                <Skeleton className="h-4 w-56" />
              </div>
            </div>
          </div>

          <div className="flex items-center overflow-x-auto divide-x divide-card-border border-t border-card-border">
            {[1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="flex flex-col px-5 py-3 min-w-max space-y-1.5">
                <Skeleton className="h-2.5 w-16" />
                <Skeleton className="h-5 w-20" />
              </div>
            ))}
          </div>
        </header>

        <div className="space-y-8">
          <TabRowSkeleton count={6} />

          <div className="grid gap-8 lg:grid-cols-2">
            <CardSkeleton className="space-y-4">
              <Skeleton className="h-5 w-36" />
              {[1, 2, 3].map((i) => (
                <ListRowSkeleton key={i} withBadge />
              ))}
            </CardSkeleton>

            <CardSkeleton className="space-y-4">
              <Skeleton className="h-5 w-32" />
              <div className="grid grid-cols-2 gap-3">
                {[1, 2, 3, 4].map((i) => (
                  <div key={i} className="rounded-lg border border-card-border p-3 space-y-1">
                    <Skeleton className="h-2.5 w-16" />
                    <Skeleton className="h-5 w-20" />
                  </div>
                ))}
              </div>
              <div className="space-y-3 pt-2">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="space-y-1">
                    <div className="flex justify-between">
                      <Skeleton className="h-3 w-20" />
                      <Skeleton className="h-3 w-10" />
                    </div>
                    <Skeleton className="h-2 w-full rounded-full" />
                  </div>
                ))}
              </div>
            </CardSkeleton>
          </div>
        </div>
      </main>
    </div>
  );
}
