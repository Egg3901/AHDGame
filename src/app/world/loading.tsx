import { Skeleton } from "@/components/ui";
import { CardSkeleton } from "@/components/ui/loading-skeletons";

/**
 * /world reads country access, game state and per-country metrics before the
 * first byte. Mirrors WorldClient's centered intro and its 4-up country grid.
 */
export default function WorldLoading() {
  return (
    <main className="mx-auto max-w-7xl space-y-12 px-4 py-10 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-2xl space-y-3 text-center">
        <Skeleton className="mx-auto h-9 w-56" />
        <Skeleton className="mx-auto h-4 w-full" />
        <Skeleton className="mx-auto h-4 w-2/3" />
      </div>

      <section className="space-y-6">
        <div className="flex items-center justify-between border-b border-card-border pb-4">
          <Skeleton className="h-6 w-40" />
          <Skeleton className="h-8 w-32 rounded-lg" />
        </div>
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <CardSkeleton key={i} className="space-y-3">
              <div className="flex items-center gap-3">
                <Skeleton className="h-8 w-12 rounded" />
                <Skeleton className="h-4 w-24" />
              </div>
              <Skeleton className="h-3 w-full" />
              <Skeleton className="h-3 w-1/2" />
            </CardSkeleton>
          ))}
        </div>
      </section>
    </main>
  );
}
