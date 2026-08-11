import { Skeleton, CardSkeleton } from "@/components/ui";

/**
 * Shared bill detail skeleton.
 * Both loading.tsx and the client component's inline loading use this.
 */
export function BillDetailSkeleton() {
  return (
    <div className="min-h-screen bg-background">
      <main className="mx-auto max-w-4xl px-6 py-8 space-y-6">
        {/* Back nav */}
        <Skeleton className="h-4 w-32" />

        {/* Header card */}
        <CardSkeleton className="space-y-4">
          <div className="flex flex-wrap items-start gap-3">
            <div className="flex-1 min-w-0 space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <Skeleton className="h-5 w-16 rounded-full" />
                <Skeleton className="h-5 w-20 rounded-full" />
                <Skeleton className="h-5 w-24 rounded-full" />
              </div>
              <Skeleton className="h-7 w-full" />
              <Skeleton className="h-7 w-3/4" />
            </div>
          </div>

          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-5/6" />
          <Skeleton className="h-4 w-4/6" />

          <div className="pt-1 border-t border-card-border/40">
            <Skeleton className="h-3 w-64" />
          </div>

          <div className="pt-2 border-t border-card-border/40 space-y-3">
            {[1, 2].map((i) => (
              <div key={i} className="flex items-start justify-between gap-3">
                <div className="flex-1 space-y-1">
                  <Skeleton className="h-4 w-40" />
                  <Skeleton className="h-3 w-full" />
                </div>
                <Skeleton className="h-4 w-16 rounded shrink-0" />
              </div>
            ))}
          </div>

          <div className="flex flex-wrap gap-2 pt-1">
            <Skeleton className="h-8 w-28 rounded-lg" />
            <Skeleton className="h-8 w-36 rounded-lg" />
            <Skeleton className="h-8 w-24 rounded-lg" />
          </div>
        </CardSkeleton>

        {/* Whip panel */}
        <CardSkeleton>
          <Skeleton className="h-5 w-32 mb-3" />
          <div className="flex gap-3">
            <Skeleton className="h-8 w-20 rounded-lg" />
            <Skeleton className="h-8 w-20 rounded-lg" />
            <Skeleton className="h-8 w-20 rounded-lg" />
          </div>
        </CardSkeleton>

        {/* Two-column: vote bars + sidebar */}
        <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
          <div className="space-y-6">
            <CardSkeleton className="space-y-3">
              <Skeleton className="h-5 w-40" />
              <Skeleton className="h-3 w-full" />
              <Skeleton className="h-3 w-full" />
              <Skeleton className="h-3 w-full" />
            </CardSkeleton>

            <CardSkeleton className="space-y-3">
              <Skeleton className="h-5 w-40" />
              <Skeleton className="h-3 w-full" />
              <Skeleton className="h-3 w-full" />
            </CardSkeleton>

            <CardSkeleton className="space-y-4">
              <div className="flex items-center gap-3">
                <Skeleton className="h-8 w-16 rounded-lg" />
                <Skeleton className="h-8 w-16 rounded-lg" />
              </div>
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
          </div>

          <div className="hidden lg:block">
            <CardSkeleton className="space-y-3">
              <Skeleton className="h-5 w-36" />
              <Skeleton className="h-24 w-full" />
              <Skeleton className="h-4 w-48" />
            </CardSkeleton>
          </div>
        </div>
      </main>
    </div>
  );
}
