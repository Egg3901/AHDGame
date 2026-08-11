import { Skeleton } from "@/components/ui";

/**
 * App-wide loading fallback — renders a skeleton shell that mirrors the
 * Navbar + main-content layout so route transitions feel instant rather
 * than swapping to a centered spinner.
 */
export default function RootLoading() {
  return (
    <div className="min-h-screen bg-background">
      {/* ── Navbar skeleton ── */}
      <div className="border-b border-card-border bg-card">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-3">
          <div className="flex items-center gap-3">
            <Skeleton className="h-8 w-8 rounded-md" />
            <Skeleton className="hidden h-5 w-40 sm:block" />
          </div>
          <div className="hidden items-center gap-4 md:flex">
            <Skeleton className="h-4 w-16" />
            <Skeleton className="h-4 w-16" />
            <Skeleton className="h-4 w-16" />
            <Skeleton className="h-4 w-16" />
            <Skeleton className="h-8 w-24" />
          </div>
        </div>
      </div>

      {/* ── Main content skeleton ── */}
      <div className="mx-auto max-w-7xl px-4 py-8">
        <div className="grid gap-8">
          {/* Hero area */}
          <div className="grid gap-6 lg:grid-cols-5">
            <div className="col-span-3 space-y-4">
              <Skeleton className="h-10 w-3/4" />
              <Skeleton className="h-10 w-1/2" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-5/6" />
              <div className="flex gap-3 pt-2">
                <Skeleton className="h-10 w-32" />
                <Skeleton className="h-10 w-32" />
              </div>
            </div>
            <div className="col-span-2">
              <Skeleton className="aspect-square w-full rounded-2xl" />
            </div>
          </div>

          {/* Strip skeleton */}
          <div className="grid grid-cols-2 gap-4 border-y border-card-border py-4 lg:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="space-y-2 px-4">
                <Skeleton className="h-3 w-20" />
                <Skeleton className="h-6 w-32" />
                <Skeleton className="h-3 w-24" />
              </div>
            ))}
          </div>

          {/* Content blocks */}
          <div className="space-y-6">
            <Skeleton className="h-8 w-48" />
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="space-y-3 rounded-xl border border-card-border p-4">
                  <Skeleton className="h-4 w-24" />
                  <Skeleton className="h-5 w-full" />
                  <Skeleton className="h-4 w-5/6" />
                  <Skeleton className="h-4 w-4/6" />
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
