import { Skeleton } from "@/components/ui";

export default function DashboardLoading() {
  return (
    <div className="min-h-screen bg-background">
      <main className="mx-auto max-w-5xl px-4 sm:px-6 py-10 space-y-6">
        {/* Page heading skeleton */}
        <div className="flex items-baseline justify-between gap-4">
          <div>
            <Skeleton className="h-8 w-48" />
            <Skeleton className="mt-2 h-3 w-32" />
          </div>
        </div>

        {/* Hero stat strip skeleton */}
        <div className="rounded-2xl border border-card-border bg-card overflow-hidden">
          <Skeleton className="h-1 w-full" />
          <div className="px-5 py-5 flex flex-col sm:flex-row sm:items-center gap-5">
            <div className="flex items-center gap-4 flex-1">
              <Skeleton className="h-14 w-14 rounded-xl shrink-0" />
              <div className="min-w-0 flex-1 space-y-2">
                <Skeleton className="h-5 w-36" />
                <Skeleton className="h-3 w-24" />
                <div className="flex gap-2">
                  <Skeleton className="h-5 w-20 rounded-full" />
                  <Skeleton className="h-5 w-16 rounded-full" />
                </div>
              </div>
            </div>
            <div className="flex gap-7 shrink-0 border-t border-card-border pt-4 sm:border-t-0 sm:pt-0 sm:border-l sm:border-card-border sm:pl-7">
              {[1, 2, 3, 4].map((i) => (
                <div key={i} className="text-center">
                  <Skeleton className="h-6 w-12 mx-auto" />
                  <Skeleton className="h-3 w-10 mx-auto mt-2" />
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Two-column layout skeleton */}
        <div className="grid gap-5 lg:grid-cols-5">
          {/* Active Campaign — 3/5 */}
          <div className="lg:col-span-3 rounded-2xl border border-card-border bg-card p-5">
            <Skeleton className="h-3 w-28 mb-4" />
            <Skeleton className="h-4 w-full mb-2" />
            <Skeleton className="h-4 w-3/4 mb-4" />
            <Skeleton className="h-2.5 w-full rounded-full mb-4" />
            <Skeleton className="h-4 w-24" />
          </div>

          {/* Notifications — 2/5 */}
          <div className="lg:col-span-2 rounded-2xl border border-card-border bg-card p-5">
            <Skeleton className="h-3 w-24 mb-4" />
            <div className="space-y-3">
              {[1, 2].map((i) => (
                <div key={i} className="rounded-xl border border-card-border p-3">
                  <Skeleton className="h-4 w-3/4 mb-2" />
                  <Skeleton className="h-3 w-full" />
                  <Skeleton className="h-3 w-16 mt-2" />
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Poll Intelligence skeleton */}
        <div className="rounded-2xl border border-card-border bg-card p-5">
          <Skeleton className="h-3 w-36 mb-3" />
          <div className="flex items-baseline gap-3">
            <Skeleton className="h-9 w-20" />
            <Skeleton className="h-4 w-48" />
          </div>
          <Skeleton className="h-3 w-40 mt-2" />
        </div>
      </main>
    </div>
  );
}
