import { Skeleton } from "@/components/ui";

// /portfolio is a large client page that fetches /api/character/portfolio +
// /api/character/me on mount. This skeleton shows during the segment load so
// the user sees the page shell immediately instead of a blank spinner.
export default function PortfolioLoading() {
  return (
    <div className="min-h-screen bg-background pb-16">
      <main className="mx-auto max-w-7xl px-4 sm:px-6 py-8 space-y-8 overflow-x-hidden">
        {/* Header + summary tiles */}
        <div className="space-y-4">
          <Skeleton className="h-8 w-48" />
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="rounded-xl border border-card-border bg-card p-4 space-y-2">
                <Skeleton className="h-3 w-20" />
                <Skeleton className="h-7 w-28" />
                <Skeleton className="h-3 w-16" />
              </div>
            ))}
          </div>
        </div>

        {/* Holdings table — real holdings count is highly variable, so reserve
            the typical loaded table height with min-h: under-run never
            collapses the card, over-run just extends below the fold. */}
        <div className="rounded-xl border border-card-border bg-card p-5 space-y-4">
          <Skeleton className="h-5 w-32" />
          <div className="min-h-[480px] space-y-3">
            {Array.from({ length: 8 }).map((_, i) => (
              <div
                key={i}
                className="flex items-center gap-3 py-2 border-b border-card-border last:border-0"
              >
                <Skeleton className="h-9 w-9 rounded-lg shrink-0" />
                <div className="flex-1 space-y-1">
                  <Skeleton className="h-4 w-40" />
                  <Skeleton className="h-3 w-24" />
                </div>
                <Skeleton className="h-5 w-20 shrink-0" />
                <Skeleton className="h-5 w-16 shrink-0" />
              </div>
            ))}
          </div>
        </div>
      </main>
    </div>
  );
}
