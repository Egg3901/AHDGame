import { Skeleton } from "@/components/ui";

// Regional party branch page (large client page: branch header, local roster,
// regional standings). The skeleton keeps the shell visible during segment load.
export default function RegionPartyLoading() {
  return (
    <div className="min-h-screen bg-background pb-16">
      <main className="mx-auto max-w-7xl px-4 sm:px-6 py-8 space-y-8 overflow-x-hidden">
        {/* Branch hero */}
        <div className="rounded-2xl border border-card-border bg-card shadow-card overflow-hidden">
          <div className="h-24 sm:h-32 bg-card-elevated animate-pulse" />
          <div className="px-5 sm:px-6 py-5 flex items-center gap-4">
            <Skeleton className="h-14 w-14 rounded-xl shrink-0" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-6 w-52" />
              <Skeleton className="h-4 w-36" />
            </div>
          </div>
        </div>

        {/* Local roster + standings */}
        <div className="grid gap-8 lg:grid-cols-3">
          {/* min-h reserves the typical loaded roster height — real rosters vary,
              so an under-run must not collapse the container (over-run only
              extends below the fold). */}
          <div className="lg:col-span-2 rounded-xl border border-card-border bg-card p-5 space-y-4 min-h-[26rem]">
            <Skeleton className="h-5 w-40" />
            {Array.from({ length: 5 }).map((_, i) => (
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
          <div className="rounded-xl border border-card-border bg-card p-5 space-y-3">
            <Skeleton className="h-4 w-28" />
            <div className="grid grid-cols-2 gap-3">
              {[1, 2, 3, 4].map((i) => (
                <div key={i} className="rounded-lg border border-card-border p-3 space-y-1">
                  <Skeleton className="h-2.5 w-14" />
                  <Skeleton className="h-5 w-16" />
                </div>
              ))}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
