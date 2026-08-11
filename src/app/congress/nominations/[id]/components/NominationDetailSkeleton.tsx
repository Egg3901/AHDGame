import { Skeleton, CardSkeleton } from "@/components/ui";

/**
 * Shared nomination detail skeleton.
 * Both loading.tsx and the client component's inline loading use this.
 */
export function NominationDetailSkeleton() {
  return (
    <div className="min-h-screen bg-background">
      <main className="mx-auto max-w-4xl px-6 py-8 space-y-6">
        {/* Back nav */}
        <Skeleton className="h-4 w-36" />

        {/* Header card */}
        <CardSkeleton className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <Skeleton className="h-5 w-16 rounded-full" />
            <Skeleton className="h-5 w-24 rounded-full" />
          </div>

          <Skeleton className="h-7 w-64" />

          <div className="flex items-center gap-3">
            <Skeleton className="h-10 w-10 rounded-xl shrink-0" />
            <div className="space-y-1">
              <Skeleton className="h-5 w-40" />
              <Skeleton className="h-3 w-24" />
            </div>
          </div>

          <div className="pt-1 border-t border-card-border/40">
            <Skeleton className="h-3 w-56" />
          </div>

          <div className="flex flex-wrap gap-2 pt-1">
            <Skeleton className="h-8 w-20 rounded-lg" />
            <Skeleton className="h-8 w-20 rounded-lg" />
          </div>
        </CardSkeleton>

        {/* Vote bar */}
        <CardSkeleton className="space-y-3">
          <Skeleton className="h-5 w-36" />
          <div className="space-y-2">
            <Skeleton className="h-6 w-full rounded" />
            <Skeleton className="h-3 w-56" />
          </div>
          <div className="flex gap-6">
            <div className="space-y-1">
              <Skeleton className="h-4 w-8" />
              <Skeleton className="h-3 w-12" />
            </div>
            <div className="space-y-1">
              <Skeleton className="h-4 w-8" />
              <Skeleton className="h-3 w-12" />
            </div>
          </div>
        </CardSkeleton>

        {/* Vote breakdown */}
        <CardSkeleton className="space-y-4">
          <Skeleton className="h-5 w-40" />
          <div className="space-y-2">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="flex items-center gap-3 py-1.5">
                <Skeleton className="h-4 w-24 shrink-0" />
                <Skeleton className="h-2 flex-1 rounded-full" />
                <Skeleton className="h-4 w-10 shrink-0" />
              </div>
            ))}
          </div>
        </CardSkeleton>
      </main>
    </div>
  );
}
