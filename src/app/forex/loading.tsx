import { Skeleton } from "@/components/ui";
import { CardSkeleton, StatGridSkeleton } from "@/components/ui/loading-skeletons";

/**
 * The /forex segment has no page of its own — this covers /forex/[country],
 * whose `global` case renders the full country forex page inline (rates,
 * reserves and intervention history) rather than redirecting. Mirrors that
 * page's max-w-7xl main.
 */
export default function ForexLoading() {
  return (
    <main className="mx-auto max-w-7xl space-y-8 px-4 py-8 sm:px-6 lg:px-8">
      <div className="space-y-2">
        <Skeleton className="h-9 w-56" />
        <Skeleton className="h-4 w-80" />
      </div>

      <CardSkeleton>
        <StatGridSkeleton cols={2} count={4} />
      </CardSkeleton>

      <CardSkeleton className="space-y-4">
        <Skeleton className="h-5 w-40" />
        <Skeleton className="h-56 w-full rounded-lg" />
      </CardSkeleton>

      <CardSkeleton className="space-y-3">
        <Skeleton className="h-5 w-36" />
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="flex items-center justify-between">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-4 w-24" />
          </div>
        ))}
      </CardSkeleton>
    </main>
  );
}
