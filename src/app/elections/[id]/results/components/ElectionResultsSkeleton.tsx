import { CardSkeleton, Skeleton } from "@/components/ui";

/** Layout-matching skeleton for the live results page (no spinners). */
export function ElectionResultsSkeleton() {
  return (
    <div className="min-h-screen bg-background">
      <main className="mx-auto max-w-6xl space-y-4 px-4 py-6 sm:px-6 sm:py-8">
        {/* Breadcrumb + title row */}
        <div className="flex items-center gap-2">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-4 w-4" />
          <Skeleton className="h-4 w-40" />
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Skeleton className="h-8 w-72" />
          <Skeleton className="h-5 w-28 rounded-full" />
        </div>

        {/* Progress bar */}
        <CardSkeleton>
          <div className="mb-2 flex justify-between">
            <Skeleton className="h-4 w-44" />
            <Skeleton className="h-3 w-24" />
          </div>
          <Skeleton className="h-2.5 w-full rounded-full" />
        </CardSkeleton>

        {/* Main bar panel */}
        <CardSkeleton>
          <Skeleton className="mb-3 h-4 w-40" />
          <Skeleton className="h-10 w-full rounded-lg" />
          <div className="mt-3 flex gap-4">
            <Skeleton className="h-3 w-28" />
            <Skeleton className="h-3 w-28" />
          </div>
        </CardSkeleton>

        {/* Candidates panel */}
        <CardSkeleton>
          <Skeleton className="mb-3 h-4 w-28" />
          {[0, 1, 2].map((i) => (
            <div key={i} className="mb-3">
              <div className="mb-1 flex justify-between">
                <Skeleton className="h-4 w-40" />
                <Skeleton className="h-3 w-32" />
              </div>
              <Skeleton className="h-2 w-full rounded-full" />
            </div>
          ))}
        </CardSkeleton>

        {/* Race card grid */}
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
          {Array.from({ length: 10 }, (_, i) => (
            <div key={i} className="rounded-lg border border-card-border bg-card p-3">
              <Skeleton className="mb-2 h-4 w-20" />
              <Skeleton className="mb-1.5 h-3 w-24" />
              <Skeleton className="h-1.5 w-full rounded-full" />
            </div>
          ))}
        </div>
      </main>
    </div>
  );
}
