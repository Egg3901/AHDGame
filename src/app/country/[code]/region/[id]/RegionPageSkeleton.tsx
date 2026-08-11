import { Skeleton, TabRowSkeleton } from "@/components/ui";

/**
 * Tabs + tab-content skeleton for the region page. Shared by the full-page
 * skeleton below and the StatePageTabs Suspense boundary so the tabbed area
 * keeps its layout (and height) while content streams in.
 */
export function RegionTabsSkeleton() {
  return (
    <div className="min-h-[480px] space-y-8">
      {/* Tab navigation */}
      <TabRowSkeleton count={6} />

      {/* Tab content — overview layout */}
      <div className="grid gap-8 lg:grid-cols-2">
        {/* Left: elections / officials */}
        <div className="rounded-xl border border-card-border bg-card p-6 space-y-4">
          <Skeleton className="h-5 w-36" />
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="flex items-center gap-3 py-2 border-b border-card-border last:border-0"
            >
              <Skeleton className="h-10 w-10 rounded-lg shrink-0" />
              <div className="flex-1 space-y-1">
                <Skeleton className="h-4 w-40" />
                <Skeleton className="h-3 w-24" />
              </div>
              <Skeleton className="h-6 w-16 rounded-full shrink-0" />
            </div>
          ))}
        </div>

        {/* Right: demographics / lean */}
        <div className="rounded-xl border border-card-border bg-card p-6 space-y-4">
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
        </div>
      </div>
    </div>
  );
}

/**
 * Full-page region skeleton — hero card + 5-stat strip + tabbed content.
 * Shared by the route's loading.tsx and the UKRegionClient Suspense fallback
 * so both loading paths render the identical layout-matching shell.
 */
export function RegionPageSkeleton() {
  return (
    <div className="min-h-screen bg-background">
      <main className="mx-auto max-w-7xl min-w-0 overflow-x-hidden px-6 sm:px-8 lg:px-12 py-12 sm:py-16 space-y-12">
        {/* Hero header card */}
        <header className="relative overflow-hidden rounded-2xl border border-card-border bg-card shadow-lg">
          {/* Hero image area */}
          <div className="relative h-[175px] w-full sm:h-[220px] bg-card-elevated animate-pulse">
            {/* Top controls row */}
            <div className="absolute inset-0 flex flex-col justify-between px-5 sm:px-6 py-4 sm:py-5">
              <div className="flex items-center justify-between gap-2">
                <Skeleton className="h-8 w-8 rounded-lg" />
                <Skeleton className="h-8 w-24 rounded-lg" />
              </div>
              {/* Title area */}
              <div className="flex items-center gap-3">
                <Skeleton className="h-10 w-14 rounded shrink-0" />
                <Skeleton className="h-9 w-48 sm:w-72" />
              </div>
            </div>
          </div>

          {/* Stats strip — responsive grid matching the live hero */}
          <div className="grid grid-cols-2 divide-y divide-card-border sm:flex sm:divide-x sm:divide-y-0 border-t border-card-border">
            {[1, 2, 3, 4, 5, 6].map((i) => (
              <div key={i} className="flex flex-col px-5 py-3 space-y-1.5">
                <Skeleton className="h-2.5 w-16" />
                <Skeleton className="h-5 w-20" />
              </div>
            ))}
          </div>
        </header>

        {/* Tabs + content */}
        <RegionTabsSkeleton />
      </main>
    </div>
  );
}
