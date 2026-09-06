import { Skeleton } from "@/components/ui";
import { CardSkeleton } from "@/components/ui/loading-skeletons";

/**
 * /news fetches the feed server-side before rendering. Mirrors
 * NewsPageClient's max-w-7xl main and its lead-plus-list feed shape.
 */
export default function NewsLoading() {
  return (
    <main className="mx-auto max-w-7xl space-y-6 overflow-hidden px-4 pb-8 pt-4 sm:px-6 lg:px-8">
      <div className="space-y-2">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-4 w-72" />
      </div>

      <CardSkeleton className="space-y-3">
        <Skeleton className="h-40 w-full rounded-lg" />
        <Skeleton className="h-6 w-3/4" />
        <Skeleton className="h-3 w-full" />
        <Skeleton className="h-3 w-2/3" />
      </CardSkeleton>

      <div className="space-y-4">
        {Array.from({ length: 6 }).map((_, i) => (
          <CardSkeleton key={i} className="flex gap-4">
            <Skeleton className="h-20 w-28 shrink-0 rounded-lg" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-3 w-full" />
              <Skeleton className="h-3 w-24" />
            </div>
          </CardSkeleton>
        ))}
      </div>
    </main>
  );
}
