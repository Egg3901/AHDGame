import { Skeleton } from "@/components/ui";
import { CardSkeleton, StatGridSkeleton } from "@/components/ui/loading-skeletons";

/**
 * /actions resolves the character, their state and influence budget before it
 * can render any action card. Mirrors the page's header, stat row and the
 * three-column action grid.
 */
export default function ActionsLoading() {
  return (
    <main className="mx-auto max-w-7xl space-y-8 overflow-x-hidden px-4 py-8 sm:px-6">
      <div className="space-y-2">
        <Skeleton className="h-9 w-48" />
        <Skeleton className="h-4 w-96" />
      </div>

      <CardSkeleton>
        <StatGridSkeleton cols={2} count={4} className="sm:[grid-template-columns:repeat(4,1fr)]" />
      </CardSkeleton>

      <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 9 }).map((_, i) => (
          <CardSkeleton key={i} className="space-y-3">
            <Skeleton className="h-5 w-2/3" />
            <Skeleton className="h-3 w-full" />
            <Skeleton className="h-3 w-4/5" />
            <div className="flex items-center justify-between pt-2">
              <Skeleton className="h-5 w-16 rounded-full" />
              <Skeleton className="h-8 w-24 rounded-lg" />
            </div>
          </CardSkeleton>
        ))}
      </div>
    </main>
  );
}
