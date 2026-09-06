import { Skeleton } from "@/components/ui";
import { CardSkeleton, StatGridSkeleton } from "@/components/ui/loading-skeletons";

/**
 * The /bond segment has no page of its own — this covers /bond/[id], which
 * loads the issue, its issuer and the holder book before rendering. Mirrors
 * that page's max-w-5xl column.
 */
export default function BondLoading() {
  return (
    <main className="mx-auto max-w-5xl space-y-6 px-4 py-8 sm:px-6">
      <div className="flex items-center gap-2">
        <Skeleton className="h-3 w-16" />
        <Skeleton className="h-3 w-3" />
        <Skeleton className="h-3 w-32" />
      </div>

      <div className="space-y-2">
        <Skeleton className="h-8 w-2/3" />
        <Skeleton className="h-4 w-40" />
      </div>

      <CardSkeleton>
        <StatGridSkeleton cols={2} count={6} />
      </CardSkeleton>

      <CardSkeleton className="space-y-3">
        <Skeleton className="h-5 w-32" />
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="flex items-center justify-between">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-4 w-20" />
          </div>
        ))}
      </CardSkeleton>
    </main>
  );
}
