import { Skeleton } from "@/components/ui";

/**
 * Shared skeleton for the party detail route — rendered by both the segment
 * `loading.tsx` and the client page's Suspense fallback / data-fetch loading
 * state, so the player sees a single uninterrupted skeleton until content
 * lands (no intermediate "Loading…" text flash).
 */
export function PartyPageSkeleton() {
  return (
    <div className="min-h-screen bg-background pb-16">
      <main className="mx-auto max-w-7xl space-y-6 overflow-x-hidden px-4 py-6 sm:px-6 sm:py-8">
        <Skeleton className="h-5 w-28" />

        <div className="overflow-hidden rounded-xl border border-card-border bg-card shadow-panel">
          <div className="border-b-4 border-card-border bg-card-elevated/60 px-4 py-6 sm:px-7 sm:py-8">
            <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex min-w-0 items-center gap-4">
                <Skeleton className="h-16 w-16 shrink-0 rounded-xl" />
                <div className="min-w-0 flex-1 space-y-2">
                  <Skeleton className="h-3 w-32" />
                  <Skeleton className="h-8 w-56 max-w-full" />
                  <div className="flex gap-2">
                    <Skeleton className="h-5 w-14 rounded-full" />
                    <Skeleton className="h-5 w-20 rounded-full" />
                  </div>
                </div>
              </div>
              <Skeleton className="h-9 w-24 rounded-lg" />
            </div>
          </div>
          <div className="grid grid-cols-2 divide-x divide-y divide-card-border sm:grid-cols-3 lg:grid-cols-6">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="space-y-2 p-4">
                <Skeleton className="h-3 w-20 max-w-full" />
                <Skeleton className="h-6 w-16 max-w-full" />
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-xl border border-card-border bg-card p-2 shadow-card">
          <div className="flex gap-2 overflow-hidden">
            {Array.from({ length: 7 }).map((_, i) => (
              <Skeleton key={i} className="h-9 w-24 shrink-0 rounded-lg" />
            ))}
          </div>
        </div>

        <div className="grid gap-6 lg:grid-cols-[minmax(0,1.6fr)_minmax(18rem,1fr)]">
          <section className="min-w-0 space-y-3">
            <div className="space-y-2">
              <Skeleton className="h-3 w-24" />
              <Skeleton className="h-7 w-48" />
            </div>
            <div className="overflow-hidden rounded-xl border border-card-border bg-card shadow-card">
              {Array.from({ length: 3 }).map((_, i) => (
                <div
                  key={i}
                  className="grid gap-3 border-b border-card-border p-4 last:border-b-0 sm:grid-cols-[9rem_minmax(0,1fr)] sm:items-center sm:p-5"
                >
                  <div className="space-y-2">
                    <Skeleton className="h-3 w-24" />
                    <Skeleton className="h-3 w-full" />
                  </div>
                  <div className="flex items-center gap-3">
                    <Skeleton className="h-12 w-12 shrink-0 rounded-lg" />
                    <Skeleton className="h-5 w-36" />
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section className="min-w-0 space-y-3">
            <div className="space-y-2">
              <Skeleton className="h-3 w-24" />
              <Skeleton className="h-7 w-40" />
            </div>
            <div className="overflow-hidden rounded-xl border border-card-border bg-card shadow-card">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="space-y-3 border-b border-card-border p-4 last:border-b-0">
                  <div className="flex justify-between gap-3">
                    <Skeleton className="h-3 w-28" />
                    <Skeleton className="h-5 w-20" />
                  </div>
                  <Skeleton className="h-2 w-full rounded-full" />
                </div>
              ))}
            </div>
          </section>
        </div>
      </main>
    </div>
  );
}
