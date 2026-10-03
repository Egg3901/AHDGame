import { Skeleton } from "@/components/ui";

/**
 * Shared skeleton for the party detail route — rendered by both the segment
 * `loading.tsx` and the client page's Suspense fallback / data-fetch loading
 * state, so the player sees a single uninterrupted skeleton until content
 * lands (no intermediate "Loading…" text flash). It follows the hub's layout:
 * a header band with the name, figures and tabs, then plain sections.
 */
export function PartyPageSkeleton() {
  return (
    <div className="min-h-screen bg-background pb-16">
      <main className="mx-auto max-w-7xl overflow-x-hidden px-4 py-6 sm:px-6 sm:py-8">
        <Skeleton className="mb-4 h-5 w-28" />

        <div className="mb-10 overflow-hidden rounded-xl border border-card-border bg-card">
          <div className="px-4 py-6 sm:px-7 sm:py-8">
            <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
              <div className="flex min-w-0 items-start gap-4">
                <Skeleton className="h-16 w-16 shrink-0 rounded-xl" />
                <div className="min-w-0 flex-1 space-y-3">
                  <Skeleton className="h-9 w-64 max-w-full" />
                  <Skeleton className="h-4 w-48 max-w-full" />
                  <Skeleton className="h-8 w-40 rounded-lg" />
                </div>
              </div>
              <Skeleton className="h-9 w-24 rounded-lg" />
            </div>
          </div>
          <div className="flex flex-wrap gap-x-10 gap-y-4 border-t border-card-border px-4 py-4 sm:px-7">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="space-y-2">
                <Skeleton className="h-3 w-20" />
                <Skeleton className="h-6 w-16" />
              </div>
            ))}
          </div>
          <div className="flex gap-6 overflow-hidden border-t border-card-border px-4 py-3.5 sm:px-7">
            {Array.from({ length: 7 }).map((_, i) => (
              <Skeleton key={i} className="h-5 w-20 shrink-0" />
            ))}
          </div>
        </div>

        <div className="grid gap-x-12 gap-y-12 lg:grid-cols-[minmax(0,1.6fr)_minmax(18rem,1fr)]">
          <section className="min-w-0">
            <Skeleton className="mb-4 h-7 w-56" />
            <div className="border-t border-card-border">
              {Array.from({ length: 3 }).map((_, i) => (
                <div
                  key={i}
                  className="grid gap-3 border-b border-card-border py-4 sm:grid-cols-[11rem_minmax(0,1fr)] sm:items-center sm:gap-6"
                >
                  <div className="space-y-2">
                    <Skeleton className="h-4 w-28" />
                    <Skeleton className="h-3 w-full" />
                  </div>
                  <div className="flex items-center gap-3">
                    <Skeleton className="h-12 w-12 shrink-0 rounded-full" />
                    <Skeleton className="h-5 w-36" />
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section className="min-w-0">
            <Skeleton className="mb-4 h-7 w-44" />
            <div className="space-y-8">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="space-y-3">
                  <div className="flex justify-between gap-3">
                    <Skeleton className="h-4 w-28" />
                    <Skeleton className="h-5 w-20" />
                  </div>
                  <Skeleton className="h-1.5 w-full rounded-full" />
                </div>
              ))}
            </div>
          </section>
        </div>
      </main>
    </div>
  );
}
