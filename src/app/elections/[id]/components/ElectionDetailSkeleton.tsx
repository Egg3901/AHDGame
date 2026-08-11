import { Skeleton, CardSkeleton, ListRowSkeleton } from "@/components/ui";

/**
 * Shared election detail skeleton.
 * Used by both elections/[id]/loading.tsx (server Suspense boundary)
 * and elections/[id]/page.tsx (client-side loading state).
 */
export function ElectionDetailSkeleton() {
  return (
    <div className="min-h-screen bg-background">
      <main className="mx-auto max-w-4xl px-4 py-6 sm:px-6 sm:py-8 overflow-x-hidden">
        {/* Back navigation + breadcrumb */}
        <div className="mb-6 flex items-center gap-2 text-sm">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-4 w-4" />
          <Skeleton className="h-4 w-48" />
        </div>

        {/* Prev / Next nav */}
        <div className="mb-4 flex items-center gap-2">
          <Skeleton className="h-8 w-24 rounded-lg" />
          <Skeleton className="h-8 w-24 rounded-lg" />
        </div>

        {/* Election header card */}
        <div className="mb-6">
          <CardSkeleton>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="space-y-2 min-w-0">
                <div className="flex items-center gap-2">
                  <Skeleton className="h-6 w-20 rounded-full" />
                  <Skeleton className="h-4 w-16 rounded-full" />
                </div>
                <Skeleton className="h-9 w-72" />
                <Skeleton className="h-4 w-48" />
              </div>
              <div className="flex gap-2 shrink-0">
                <Skeleton className="h-9 w-28 rounded-lg" />
                <Skeleton className="h-9 w-32 rounded-lg" />
              </div>
            </div>
          </CardSkeleton>
        </div>

        {/* Admin section skeleton */}
        <div className="mb-4">
          <Skeleton className="h-8 w-32 rounded-lg" />
        </div>

        {/* Timeline strip */}
        <div className="mb-6">
          <div className="rounded-lg border border-card-border bg-card px-4 py-3">
            <div className="grid grid-cols-[1fr_auto] gap-x-8 gap-y-1.5">
              {[1, 2, 3].map((i) => (
                <div key={i} className="flex items-center gap-1.5">
                  <Skeleton className="h-1.5 w-1.5 rounded-full shrink-0" />
                  <Skeleton className="h-3 w-24" />
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Phase note */}
        <div className="mb-6">
          <Skeleton className="h-3 w-full" />
          <Skeleton className="mt-1 h-3 w-3/4" />
        </div>

        {/* Party cards with candidate rows */}
        <div className="space-y-4">
          {[1, 2].map((p) => (
            <CardSkeleton key={p}>
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <Skeleton className="h-6 w-6 rounded" />
                  <Skeleton className="h-5 w-32" />
                </div>
                <Skeleton className="h-4 w-16" />
              </div>
              {[1, 2, 3].map((c) => (
                <ListRowSkeleton key={c} withBadge />
              ))}
            </CardSkeleton>
          ))}

          {/* Campaign panels skeleton */}
          <CardSkeleton>
            <Skeleton className="h-5 w-36 mb-4" />
            <div className="space-y-3">
              {[1, 2].map((i) => (
                <div
                  key={i}
                  className="flex items-center gap-3 py-2 border-b border-card-border last:border-0"
                >
                  <Skeleton className="h-8 w-8 rounded shrink-0" />
                  <div className="flex-1 space-y-1">
                    <Skeleton className="h-4 w-40" />
                    <Skeleton className="h-3 w-56" />
                  </div>
                  <Skeleton className="h-5 w-12" />
                </div>
              ))}
            </div>
          </CardSkeleton>
        </div>
      </main>
    </div>
  );
}
