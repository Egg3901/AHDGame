import { Skeleton } from "@/components/ui";

/** Section placeholder: a heading over a hairline, then content rows. */
function SectionSkeleton({ rows, children }: { rows?: number; children?: React.ReactNode }) {
  return (
    <div className="space-y-3">
      <div className="border-b border-card-border pb-2">
        <Skeleton className="h-5 w-40" />
      </div>
      {children ??
        Array.from({ length: rows ?? 3 }).map((_, i) => (
          <div key={i} className="flex items-center justify-between gap-4 py-1.5">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-4 w-16" />
          </div>
        ))}
    </div>
  );
}

export default function ProfileLoading() {
  return (
    <div className="min-h-screen bg-background pb-16">
      <main className="mx-auto max-w-7xl space-y-10 overflow-x-hidden px-4 py-8 sm:px-6">
        {/* Identity block */}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:gap-6">
          <Skeleton className="h-20 w-20 shrink-0 rounded-lg sm:h-24 sm:w-24" />
          <div className="min-w-0 flex-1 space-y-3">
            <div className="flex flex-col gap-3 sm:flex-row sm:justify-between">
              <div className="space-y-2">
                <Skeleton className="h-8 w-56 sm:h-9 sm:w-72" />
                <Skeleton className="h-5 w-44" />
              </div>
              <div className="flex gap-2">
                <Skeleton className="h-8 w-20 rounded-md" />
                <Skeleton className="h-8 w-28 rounded-md" />
              </div>
            </div>
            <Skeleton className="h-4 w-full max-w-lg" />
            <Skeleton className="h-4 w-full max-w-2xl" />
          </div>
        </div>

        {/* Tab row */}
        <div className="flex gap-6 border-b border-card-border pb-2">
          <Skeleton className="h-5 w-20" />
          <Skeleton className="h-5 w-20" />
          <Skeleton className="h-5 w-28" />
        </div>

        <div className="grid gap-x-12 gap-y-10 lg:grid-cols-3">
          {/* Left (2/3): standing, stats, finances */}
          <div className="min-w-0 space-y-10 lg:col-span-2">
            <SectionSkeleton rows={6} />
            <SectionSkeleton rows={4} />
            <SectionSkeleton>
              <div className="grid grid-cols-3 gap-4">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="space-y-1.5">
                    <Skeleton className="h-3 w-20" />
                    <Skeleton className="h-5 w-24" />
                  </div>
                ))}
              </div>
            </SectionSkeleton>
          </div>

          {/* Right (1/3): positions, social, career */}
          <div className="min-w-0 space-y-10">
            <SectionSkeleton>
              <Skeleton className="aspect-square w-full max-w-[320px] rounded-md" />
            </SectionSkeleton>
            <SectionSkeleton rows={1} />
            <SectionSkeleton rows={3} />
          </div>
        </div>

        {/* Achievements */}
        <SectionSkeleton>
          <div className="flex flex-wrap gap-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-20 w-20 rounded-md" />
            ))}
          </div>
        </SectionSkeleton>
      </main>
    </div>
  );
}
